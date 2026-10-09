import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { loadState, inside, need, hash, atomicWrite } from './store.mjs';
import { applyEvent } from './harness.mjs';

// A host-owned bridge, rather than an arbitrary command found inside source
// documents. No shell interpolation, no resume flags, no full author state.
export async function executeBridge(root, revision, adapter) {
  const s = loadState(root);
  need(s.revision === revision, 'STALE_REVISION', '执行前状态已改变。');
  const req = s.reviewRequests.find(x => x.status === 'pending');
  need(req, 'NO_REVIEW_REQUEST', '先 prepare-review。');
  need(typeof adapter?.command === 'string' && Array.isArray(adapter.args) && adapter.args.every(x => typeof x === 'string'), 'BRIDGE_CONFIG', '桥接命令必须是可执行程序及参数数组。');
  need(adapter.runtimeId === s.host.runtimeId && adapter.model === s.host.model, 'BRIDGE_HOST', '主评审桥接必须沿用当前 host/模型。');
  const packet = JSON.parse(fs.readFileSync(inside(root, req.file), 'utf8'));
  const { packetHash, ...body } = packet;
  need(packetHash === req.packetHash && hash(body) === req.packetHash, 'PACKET_CHANGED', '评审包已被改动。');
  need(adapter.envKeys === undefined || (Array.isArray(adapter.envKeys) && adapter.envKeys.every(x => typeof x === 'string')), 'BRIDGE_CONFIG', 'envKeys 需要显式变量名数组。');
  const timeoutMs = adapter.timeoutMs ?? 180000;
  need(Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000, 'BRIDGE_TIMEOUT', '桥接执行需有 1–600 秒的超时上限。');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ere-prd-review-'));
  let result;
  try {
  // This bounds supplied files, but is NOT itself an OS read sandbox. The
  // runtime must enforce no tools or packet-only access and attest the controls.
  for (const asset of packet.assets) {
    const target = path.join(work, asset.name); fs.mkdirSync(path.dirname(target), { recursive: true });
    const bytes = fs.readFileSync(inside(root, `${path.posix.dirname(req.file)}/${asset.name}`));
    need(hash(bytes) === asset.hash, 'ASSET_CHANGED', '封存评审配图已被修改。');
    fs.writeFileSync(target, bytes);
  }
  const env = {};
  for (const key of new Set(['PATH', 'SystemRoot', 'TEMP', 'TMP', ...(adapter.envKeys ?? [])])) if (process.env[key] !== undefined) env[key] = process.env[key];
    result = await new Promise((resolve, reject) => {
      const child = spawn(adapter.command, adapter.args, { cwd: work, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const output = []; let size = 0, settled = false;
      const stop = error => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); reject(error); };
      const timer = setTimeout(() => stop(Object.assign(new Error('评审超时。'), { code: 'BRIDGE_TIMEOUT' })), timeoutMs);
      child.on('error', stop);
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) stop(Object.assign(new Error('评审输出超过 2MB。'), { code: 'BRIDGE_OUTPUT_LIMIT' })); else output.push(chunk); });
      // Do not log stderr: third-party runners may include credentials or prompts.
      child.stderr.resume();
      child.on('close', code => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (code !== 0) reject(Object.assign(new Error(`评审桥接退出码 ${code}，未将失败当作达标。`), { code: 'BRIDGE_FAILED' }));
        else { try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); } catch { reject(Object.assign(new Error('桥接未返回单个有效 JSON。'), { code: 'BRIDGE_FORMAT' })); } }
      });
      child.stdin.end(JSON.stringify({ protocol: 'ere-prd-review/1', packet, assetDirectory: work }));
    });
    atomicWrite(inside(root, `incoming-reviews/${req.requestId}-${hash(result)}.json`), JSON.stringify(result, null, 2));
    const latest = loadState(root);
    need(latest.revision === revision, 'STALE_REVISION', '运行期间作者修改了 run，结果保留为未接收，重新检查版本后处理。');
    return applyEvent(root, { revision, type: 'review-result', result });
  } catch (error) {
    const latest = loadState(root);
    if (latest.revision === revision) applyEvent(root, { revision, type: 'review-failed', requestId: req.requestId, reason: error.code ?? 'BRIDGE_FAILED' });
    throw error;
  } finally {
    // Created directly by this function; verify parent before recursive removal.
    if (path.dirname(path.resolve(work)) === path.resolve(os.tmpdir()) && path.basename(work).startsWith('ere-prd-review-')) fs.rmSync(work, { recursive: true, force: true });
  }
}
