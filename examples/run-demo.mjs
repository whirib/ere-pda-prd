import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToReview, prepare, mockResult, send, advance } from './fixture.mjs';
import { loadState } from '../skills/ere-prd/scripts/lib/store.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.resolve(process.argv[2] ?? path.join(repo, '.demo-output', `run-${Date.now()}`));
buildToReview(root);
const packet = prepare(root);
send(root, { type: 'review-result', result: mockResult(root, packet) }); advance(root);
send(root, { type: 'artifact', stage: 'resolve', data: { commitments: [{ claimId: 'C-scope', status: 'preserved', quote: '本期只支持员工提交需求，不包含自动审批。' }] } }); advance(root);
const delivery = send(root, { type: 'export' }).result; advance(root);
console.log(JSON.stringify({ status: loadState(root).stage, note: '离线虚构示例：覆盖完整流程，评审回执为 fixture；不代表真实模型测试通过。', root, prd: path.join(root, delivery.files.find(x => x.path.endsWith('PRD.md')).path) }, null, 2));
