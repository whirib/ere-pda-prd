#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initRun, applyEvent, inspectRun } from './lib/harness.mjs';
import { loadState } from './lib/store.mjs';
import { RUBRICS } from './lib/gates.mjs';
import { executeBridge } from './lib/bridge.mjs';
import { interviewStatus, interviewBasis } from './lib/interview.mjs';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

export function main(argv = process.argv.slice(2)) {
  const [command, root, input] = argv;
  if (command === 'help' || !command) return { commands: ['init <run-dir> <config.json>', 'status <run-dir>', 'interview-status <run-dir>', 'check <run-dir> [stage]', 'apply <run-dir> <event.json>', 'quality-template <run-dir>'],
    note: '主 agent 查证事实、采访和写作。采访事件约束实际回答与依赖顺序；待答问题不自动延期，provisional 不替代用户决定。代码不认证人类身份或证明产品判断正确。桥接执行：run-review <run-dir> <adapter.json>。' };
  if (!root) throw new Error('缺少 run 目录。');
  if (command === 'init') return initRun(root, readJson(input));
  if (command === 'status') {
    const s = loadState(root);
    return { title: s.title, stage: s.stage, revision: s.revision, host: s.host, sourceCount: Object.keys(s.sources).length,
      prdHash: s.draft?.hash ?? null, gates: Object.keys(s.gates), reviewRounds: s.reviews.length, reviewCalls: s.reviewRequests.length, report: inspectRun(root) };
  }
  if (command === 'check') return inspectRun(root, input);
  if (command === 'interview-status') {
    const s = loadState(root), status = interviewStatus(s);
    return { revision: s.revision, basis: interviewBasis(s), ...status,
      nodes: s.interview?.plan?.nodes ?? [], summary: s.interview?.summary ?? null };
  }
  if (command === 'apply') return applyEvent(root, readJson(input));
  if (command === 'run-review') { const adapter = readJson(input); return executeBridge(root, adapter.revision, adapter); }
  if (command === 'quality-template') {
    const s = loadState(root), { basis } = inspectRun(root);
    return { revision: s.revision, type: 'advance', quality: { basis, checks: (RUBRICS[s.stage] ?? []).map(id => ({ id, status: 'fail', reason: '请完成语义判断', anchors: [] })) } };
  }
  throw new Error(`未知命令 ${command}。`);
}
// Resolve both sides because installed skills can be reached through a symlink or Windows junction.
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { const result = await main(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); if (result.ok === false) process.exitCode = 2; }
  catch (error) { process.stderr.write(`${JSON.stringify({ error: error.code ?? 'ERROR', message: error.message })}\n`); process.exitCode = 1; }
}
