import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value ?? null)).digest('hex');
export const clone = value => structuredClone(value);
export const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const need = (condition, code, message) => { if (!condition) fail(code, message); };
export const textValue = value => typeof value === 'string' && value.trim().length > 0;
export const idValue = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);

// Check both lexical and real paths: a symlink inside a run must not escape it.
export function inside(root, name) {
  const base = path.resolve(root), target = path.resolve(base, name);
  const relative = path.relative(base, target);
  need(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'PATH_ESCAPE', '产物路径必须在本次 run 内。');
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realBase = fs.realpathSync(base), realAncestor = fs.realpathSync(ancestor);
  const realRelative = path.relative(realBase, realAncestor);
  need(realRelative !== '..' && !realRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(realRelative), 'PATH_ESCAPE', '产物父目录通过链接指向 run 外。');
  if (fs.existsSync(target)) {
    const real = path.relative(realBase, fs.realpathSync(target));
    need(real !== '..' && !real.startsWith(`..${path.sep}`) && !path.isAbsolute(real), 'PATH_ESCAPE', '产物通过链接指向 run 外。');
  }
  return target;
}

export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function loadState(root) {
  const file = inside(root, 'state.json');
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail('STATE_UNREADABLE', `状态读取失败，保留原文件；请从有效 state 快照恢复：${error.message}`); }
  need(state?.schema === 1 && Number.isSafeInteger(state.revision) && state.revision >= 0, 'STATE_SCHEMA', '状态版本或 revision 无效。');
  for (const key of ['sources', 'artifacts', 'gates', 'host', 'policy']) need(state[key] && typeof state[key] === 'object' && !Array.isArray(state[key]), 'STATE_SCHEMA', `状态 ${key} 无效。`);
  for (const key of ['diagrams', 'reviews', 'reviewRequests', 'decisions', 'log']) need(Array.isArray(state[key]), 'STATE_SCHEMA', `状态 ${key} 无效。`);
  need(['intake', 'discovery', 'solution', 'specification', 'visuals', 'review', 'resolve', 'export', 'done'].includes(state.stage), 'STATE_SCHEMA', '状态 stage 无效。');
  return state;
}

export function transaction(root, revision, operation) {
  need(Number.isSafeInteger(revision), 'REVISION_REQUIRED', '每次写入都需要从 status 取得的 revision。');
  const lock = inside(root, 'write.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('RUN_BUSY', '另一个写入正在进行。重读状态后重试；崩溃残留锁需核实进程结束后再移除。'); throw error; }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const current = loadState(root);
    need(current.revision === revision, 'STALE_REVISION', `状态已更新：输入 ${revision}，当前 ${current.revision}。请重新读取并合并。`);
    const next = clone(current);
    const result = operation(next);
    next.revision++;
    next.updatedAt = new Date().toISOString();
    atomicWrite(inside(root, `history/state-${current.revision}.json`), JSON.stringify(current, null, 2));
    atomicWrite(inside(root, 'state.json'), JSON.stringify(next, null, 2));
    return { state: next, result };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
