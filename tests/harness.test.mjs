import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initRun, applyEvent, inspectRun } from '../skills/ere-prd/scripts/lib/harness.mjs';
import { loadState, hash, inside } from '../skills/ere-prd/scripts/lib/store.mjs';
import { check, semanticIssues } from '../skills/ere-prd/scripts/lib/gates.mjs';
import { renderDiagram } from '../skills/ere-prd/scripts/lib/visuals.mjs';
import { executeBridge } from '../skills/ere-prd/scripts/lib/bridge.mjs';
import { packetFor, validateReview } from '../skills/ere-prd/scripts/lib/review.mjs';
import { main } from '../skills/ere-prd/scripts/prd.mjs';
import { buildToReview, send, advance, prepare, mockResult, raw, intakeArtifact, demonstrationQuality, prd, mapping, graph } from '../examples/fixture.mjs';

const tmp = t => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ere-prd-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; };
const init = root => initRun(root, { title: 'test', host: { runtimeId: 'fixture-host', model: 'fixture-model', authorSessionId: 'fixture-author' } });
const expectCode = (fn, code) => assert.throws(fn, e => e.code === code);
const has = (s, stage, code) => assert.ok(check(s, stage).issues.some(x => x.code === code), JSON.stringify(check(s, stage)));
function reviewed(root, findings = []) { buildToReview(root); const p = prepare(root); send(root, { type: 'review-result', result: mockResult(root, p, findings) }); advance(root); return p; }
const finding = { id: 'F1', kind: 'question', severity: 'blocker', quote: '保存失败保留输入，允许重试', issue: '离开页面是否保留输入未说明', impact: '不同实现导致丢失行为不一致', suggestion: '明确页面内或跨页面的保留边界' };

test('完整中文资料、需求、图、冷读回执和交付流程可恢复完成', t => {
  const root = tmp(t); reviewed(root);
  send(root, { type: 'artifact', stage: 'resolve', data: { commitments: [{ claimId: 'C-scope', status: 'preserved', quote: '本期只支持员工提交需求，不包含自动审批。' }] } }); advance(root);
  const delivery = send(root, { type: 'export' }).result; advance(root);
  assert.equal(loadState(root).stage, 'done'); assert.ok(fs.readFileSync(path.join(root, delivery.files[0].path)).length);
  assert.ok(fs.readdirSync(path.join(root, 'history')).length > 5);
});
test('不能跳阶段或用空章节宣布达标', t => {
  const root = tmp(t); init(root);
  expectCode(() => send(root, { type: 'artifact', stage: 'solution', data: {} }), 'ARTIFACT_STAGE');
  expectCode(() => advance(root), 'GATE_BLOCKED'); assert.equal(loadState(root).stage, 'intake');
});
test('文档和访谈都要纳入；遗漏任何来源会阻止推进', t => {
  const root = tmp(t); init(root); for (const source of Object.values(raw)) send(root, { type: 'source', source });
  const a = intakeArtifact(loadState(root)); a.coverage.pop(); send(root, { type: 'artifact', stage: 'intake', data: a });
  has(loadState(root), 'intake', 'SOURCE_NOT_CONSIDERED');
});
test('文档中的关键图表未读不能被正文摘要掩盖', t => {
  const root = tmp(t); init(root);
  send(root, { type: 'source', source: { ...raw.document, units: [...raw.document.units, { id: 'chart', locator: '第 2 页流程图', text: '', read: false }] } });
  send(root, { type: 'source', source: raw.interview }); const a = intakeArtifact(loadState(root));
  const row = a.coverage[0].units.find(x => x.id === 'chart'); row.disposition = 'unread'; row.material = true;
  send(root, { type: 'artifact', stage: 'intake', data: a }); has(loadState(root), 'intake', 'MATERIAL_UNREAD');
  row.disposition = 'used'; send(root, { type: 'artifact', stage: 'intake', data: a }); has(loadState(root), 'intake', 'FALSE_READ_RECEIPT');
});
test('编造原文引用及过期来源版本被拒绝', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  s.artifacts.intake.claims[0].evidence[0].quote = '用户已经付费'; has(s, 'intake', 'INVALID_EVIDENCE');
  s.artifacts.intake.claims[0].evidence[0].quote = raw.document.units[0].text; s.artifacts.intake.claims[0].evidence[0].sourceHash = 'old'; has(s, 'intake', 'INVALID_EVIDENCE');
});
test('影响核心方向的资料冲突阻止推进', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  s.artifacts.intake.conflicts = [{ id: 'conflict1', material: true, status: 'open', claimIds: ['C-scope', 'C-user'] }]; has(s, 'intake', 'MATERIAL_CONFLICT');
});
test('关键缺口阻止锁方案，暂定信息允许形成有验证计划的草稿', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root), u = s.artifacts.discovery.core.user;
  u.status = 'critical_gap'; has(s, 'discovery', 'CRITICAL_GAP');
  u.status = 'provisional'; u.validation = '观察两类角色当前任务，选择首期使用者';
  assert.equal(check(s, 'discovery').ok, true); assert.ok(check(s, 'discovery').warnings.some(x => x.code === 'PROVISIONAL'));
});
test('没有新证据的重复问题转成待验证任务', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  s.artifacts.discovery.questions = [{ id: 'Q1', question: '是否跨页面保留输入', materialImpact: '改变恢复行为', attempts: 2, status: 'open' }]; has(s, 'discovery', 'INTERVIEW_LOOP');
  Object.assign(s.artifacts.discovery.questions[0], { status: 'deferred', validation: '用户确认保留边界', impact: '影响 FR-02' }); assert.equal(check(s, 'discovery').ok, true);
});
test('方向缺口仍在时可交探索草稿，但不能假装进入下一阶段', t => {
  const root = tmp(t); init(root); for (const source of Object.values(raw)) send(root, { type: 'source', source });
  send(root, { type: 'artifact', stage: 'intake', data: intakeArtifact(loadState(root)) }); advance(root);
  send(root, { type: 'artifact', stage: 'discovery', data: { core: { user: { status: 'critical_gap', summary: '角色未定', claimIds: ['C-user'] } } } });
  send(root, { type: 'draft', exploratory: true, text: '# 探索草稿\n两种角色方案待定，不能开始实现。', mapping: [] });
  const out = send(root, { type: 'draft-export' }).result; assert.equal(out.status, 'draft'); assert.equal(loadState(root).stage, 'discovery');
  assert.ok(!out.missing.some(x => x.code === 'COMMITMENT_ERODED')); assert.ok(out.pending.includes('resolve'));
  expectCode(() => advance(root), 'GATE_BLOCKED'); expectCode(() => send(root, { type: 'export' }), 'WRONG_STAGE');
});
test('模型行为及冷执行契约触发后不能漏评测、拒答或负责人', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root), spec = s.artifacts.specification;
  spec.requirements[0].ai = { applicable: true, normal: '摘要生成' }; has(s, 'specification', 'NO_AI_EVAL');
  assert.ok(check(s, 'specification').issues.some(x => x.location === 'FR-01/ai/refusal'));
  delete spec.handoff.owner; assert.ok(check(s, 'specification').issues.some(x => x.location === 'handoff/owner'));
});
test('结构化需求或关键未决项不能在 PRD 中悄悄消失', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  s.draft.mapping.pop(); has(s, 'specification', 'DRAFT_REQUIREMENT_MISSING');
  s.artifacts.specification.openItems = [{ id: 'Q1', question: '何时清除输入', impact: '恢复行为', owner: '产品负责人', quote: '不存在的段落', material: true }]; s.draft.specHash = hash(s.artifacts.specification); has(s, 'specification', 'HIDDEN_OPEN_ITEM');
});
test('语义闸门需要当前依据及实际原文，不能自评分跳过', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root); s.stage = 'solution';
  const q = demonstrationQuality(s); q.basis = 'old'; assert.ok(semanticIssues(s, q).some(x => x.code === 'QUALITY_STALE'));
  q.basis = inspectRun(root, 'solution').basis; q.checks[0].anchors = ['章节看起来很多']; assert.ok(semanticIssues(s, q).some(x => x.code === 'QUALITY_ANCHOR'));
  q.checks[1].status = 'not_applicable'; assert.ok(semanticIssues(s, q).some(x => x.code === 'QUALITY_CANNOT_SKIP'));
});
test('新文档版本使所有下游闸门和 PRD 依据失效', t => {
  const root = tmp(t); reviewed(root);
  send(root, { type: 'source', source: { ...raw.document, version: '2', units: [{ ...raw.document.units[0], text: `${raw.document.units[0].text} 新要求：保存草稿。` }] } });
  const s = loadState(root); assert.equal(s.stage, 'intake'); assert.deepEqual(s.gates, {}); has(s, 'specification', 'DRAFT_STALE');
});
test('PRD 修改会返工，但不覆盖独立首轮报告', t => {
  const root = tmp(t); const p = reviewed(root); const original = fs.readFileSync(path.join(root, `reviews/${p.requestId}.json`), 'utf8');
  send(root, { type: 'draft', text: `${prd}\n新增说明：保留当前页面输入。`, mapping });
  assert.equal(loadState(root).stage, 'specification'); assert.equal(fs.readFileSync(path.join(root, `reviews/${p.requestId}.json`), 'utf8'), original);
  assert.equal(loadState(root).reviews.length, 1);
});
test('PRD 文字未变但来源/配图变了，也不能复用旧评审', t => {
  const root = tmp(t); reviewed(root); const s = loadState(root); s.diagrams[0].hash = 'new-image';
  has(s, 'review', 'NO_INDEPENDENT_REVIEW'); has(s, 'resolve', 'FINAL_UNREVIEWED');
  s.diagrams = loadState(root).diagrams; s.sources.D1.version = '2'; has(s, 'review', 'NO_INDEPENDENT_REVIEW');
  const pending = tmp(t); buildToReview(pending); const p = prepare(pending), r = mockResult(pending, p), changed = loadState(pending); changed.diagrams[0].hash = 'new-image';
  expectCode(() => validateReview(changed, p, r), 'REVIEW_STALE');
  send(pending, { type: 'draft', text: prd + '\n新说明', mapping }); assert.equal(loadState(pending).reviewRequests[0].status, 'stale');
});
test('首轮评审包不含文档/访谈/作者摘要/项目记忆', t => {
  const root = tmp(t); buildToReview(root);
  const s = loadState(root); s.artifacts.intake.secretAuthorMemory = 'CANARY_AUTHOR_MEMORY_ONLY';
  s.artifacts.discovery.authorSummary = 'CANARY_AUTHOR_SUMMARY_ONLY';
  const packet = packetFor(s);
  assert.ok(!JSON.stringify(packet).includes(raw.interview.units[0].text)); assert.ok(!JSON.stringify(packet).includes('CANARY_AUTHOR_'));
  assert.ok(!JSON.stringify(packet).includes('fixture-author'));
  assert.deepEqual(Object.keys(packet.evidence), []); assert.equal(packet.routedIssues.length, 0); assert.equal(packet.mode, 'cold');
});
test('冷读禁止带作者证据；封存包不可改动', t => {
  const root = tmp(t); buildToReview(root); expectCode(() => prepare(root, ['C-goal']), 'COLD_EVIDENCE_LEAK');
  const p = prepare(root), request = loadState(root).reviewRequests[0];
  const changed = { ...p, rubric: '改成只夸奖' }; fs.writeFileSync(path.join(root, request.file), JSON.stringify(changed));
  expectCode(() => send(root, { type: 'review-result', result: mockResult(root, p) }), 'PACKET_CHANGED');
});
test('不继承对话但记忆状态不明时，不能声称隔离通过', t => {
  const root = tmp(t); buildToReview(root); const p = prepare(root), result = mockResult(root, p); delete result.runtimeReceipt.automaticMemory;
  send(root, { type: 'review-result', result }); has(loadState(root), 'review', 'ISOLATION_UNVERIFIED');
  expectCode(() => advance(root), 'GATE_BLOCKED'); const out = send(root, { type: 'draft-export' }).result;
  assert.equal(out.status, 'draft'); assert.equal(loadState(root).stage, 'review');
});
test('复用作者会话、默认更换模型、越界输入均被拒绝', t => {
  const root = tmp(t); buildToReview(root); const p = prepare(root);
  let r = mockResult(root, p); r.runtimeReceipt.sessionId = 'fixture-author'; expectCode(() => send(root, { type: 'review-result', result: r }), 'SESSION_REUSED');
  r = mockResult(root, p); r.runtimeReceipt.model = 'other-model'; expectCode(() => send(root, { type: 'review-result', result: r }), 'DEFAULT_MODEL_CHANGED');
  r = mockResult(root, p); r.runtimeReceipt.inputs.push({ name: 'author-summary', hash: 'bad' }); expectCode(() => send(root, { type: 'review-result', result: r }), 'INPUT_MANIFEST_MISMATCH');
});
test('评审结果绑定正确 PRD，必须先复述理解，允许没有意见', t => {
  const root = tmp(t); buildToReview(root); const p = prepare(root); let r = mockResult(root, p); r.prdHash = 'old';
  expectCode(() => send(root, { type: 'review-result', result: r }), 'REVIEW_VERSION');
  r = mockResult(root, p); delete r.report.understanding.flow; expectCode(() => send(root, { type: 'review-result', result: r }), 'MISSING_UNDERSTANDING');
  send(root, { type: 'review-result', result: mockResult(root, p) }); assert.equal(check(loadState(root)).ok, true);
});
test('具体阻断意见不能靠延期或讨论结束变成达标', t => {
  const root = tmp(t); reviewed(root, [finding]);
  send(root, { type: 'decision', decision: { findingId: 'R1-F1', action: 'deferred', reason: '用户以后决定' } });
  send(root, { type: 'artifact', stage: 'resolve', data: { commitments: [{ claimId: 'C-scope', status: 'preserved', quote: '本期只支持员工提交需求，不包含自动审批。' }] } });
  has(loadState(root), 'resolve', 'REVIEW_BLOCKER'); expectCode(() => advance(root), 'GATE_BLOCKED');
});
test('复审只带逐意见回复与必要证据，不继承两方完整记忆', t => {
  const root = tmp(t); reviewed(root, [finding]);
  send(root, { type: 'decision', decision: { findingId: 'R1-F1', action: 'rebutted', reason: '本次约定是页面内重试，不含离开页保存', claimIds: ['C-guard'] } });
  const p = prepare(root, ['C-guard']); assert.equal(p.mode, 'evidence_review'); assert.equal(p.routedIssues.length, 1); assert.equal(p.evidence.length, 1);
  assert.ok(!JSON.stringify(p).includes(raw.interview.units[0].text));
  expectCode(() => prepare(root), 'REVIEW_PENDING');
});
test('轮数和失败调用都有上限，不能递归无限重试', t => {
  const root = tmp(t); reviewed(root);
  for (let i = 0; i < 2; i++) { const p = prepare(root); send(root, { type: 'review-result', result: mockResult(root, p) }); }
  expectCode(() => prepare(root), 'DEBATE_LIMIT');
  const failed = tmp(t); buildToReview(failed);
  for (let i = 0; i < 6; i++) { const p = prepare(failed); send(failed, { type: 'review-failed', requestId: p.requestId, reason: 'timeout' }); }
  expectCode(() => prepare(failed), 'REVIEW_BUDGET');
});
test('承诺删减和范围侵蚀阻止交付，即使所有模型说可读', t => {
  const root = tmp(t); reviewed(root);
  send(root, { type: 'artifact', stage: 'resolve', data: { commitments: [{ claimId: 'C-scope', status: 'weakened', quote: '本期只支持员工提交需求，不包含自动审批。' }] } });
  has(loadState(root), 'resolve', 'COMMITMENT_ERODED');
});
test('只写配图源码/未查看图片不能算图表完成', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root); s.diagrams = []; has(s, 'visuals', 'DIAGRAM_UNRENDERED');
  s.diagrams = loadState(root).diagrams; s.artifacts.visuals.decisions[0].qa = {}; has(s, 'visuals', 'DIAGRAM_NOT_INSPECTED');
});
test('生成工具拒绝不存在节点、重叠布局和纯线性流程图', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  expectCode(() => renderDiagram(s, { ...graph, edges: [{ from: 'fill', to: 'missing' }] }), 'EDGE_ENDPOINT');
  expectCode(() => renderDiagram(s, { ...graph, nodes: graph.nodes.map(n => ({ ...n, x: 400, y: 110 })) }), 'NODE_OVERLAP');
  expectCode(() => renderDiagram(s, { ...graph, nodes: graph.nodes.slice(0, 2), edges: [{ from: 'fill', to: 'submit' }] }), 'LINEAR_DIAGRAM');
});
test('数据图拒绝无来源数值及伪时间轴', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root), chart = { ...graph, type: 'bar', unit: '条', points: [{ label: 'A', value: 500, claimId: 'C-user' }, { label: 'B', value: 900, claimId: 'C-goal' }] };
  expectCode(() => renderDiagram(s, chart), 'UNSOURCED_CHART');
  s.artifacts.intake.claims.push({ id: 'numeric', kind: 'fact', evidence: [{ quote: 'A 2 条；B 4 条' }] });
  expectCode(() => renderDiagram(s, { ...chart, type: 'line', points: [{ label: '周一', value: 2, time: 1, claimId: 'numeric' }, { label: '周三', value: 4, time: 1, claimId: 'numeric' }] }), 'CHART_TIME');
});
test('数值子串、畸形产物与省略条件评估不能绕过检查', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  s.artifacts.intake.claims.push({ id: 'numeric', kind: 'fact', evidence: [{ quote: '20 条；40 条' }] });
  expectCode(() => renderDiagram(s, { ...graph, type: 'bar', unit: '条', points: [{ label: 'A', value: 2, claimId: 'numeric' }, { label: 'B', value: 4, claimId: 'numeric' }] }), 'UNSOURCED_CHART');
  expectCode(() => send(root, { type: 'artifact', stage: 'intake', data: { claims: '不是数组' } }), 'ARTIFACT_FORMAT');
  delete s.artifacts.specification.requirements[0].ai; has(s, 'specification', 'CONDITIONAL_ASSESSMENT');
});
test('禁用工具的隔离回执不能同时声称调用了工具', t => {
  const root = tmp(t); buildToReview(root); const p = prepare(root), r = mockResult(root, p);
  r.runtimeReceipt.toolCalls = [{ inputName: 'PRD.md', allowed: true }];
  send(root, { type: 'review-result', result: r }); has(loadState(root), 'review', 'ISOLATION_UNVERIFIED');
});
test('作者反驳最新 blocker 后仍需独立复审，来源元数据更新会返工', t => {
  const root = tmp(t); reviewed(root, [finding]);
  send(root, { type: 'decision', decision: { findingId: 'R1-F1', action: 'rebutted', reason: '作者认为已有约定', claimIds: ['C-guard'] } });
  has(loadState(root), 'resolve', 'FINAL_REVIEW_BLOCKER');
  send(root, { type: 'source', source: { ...raw.document, reader: 'new-reader' } }); assert.equal(loadState(root).stage, 'intake');
});
test('图或交付文件被手工改动后，不能继续用旧哈希通过', t => {
  const root = tmp(t); buildToReview(root); const s = loadState(root);
  fs.appendFileSync(path.join(root, s.diagrams[0].file), '<!-- change -->'); assert.ok(inspectRun(root).issues.some(x => x.code === 'ASSET_CHANGED'));
});
test('并发/旧 revision 不覆盖其他修改，损坏状态会明确失败', t => {
  const root = tmp(t); init(root); send(root, { type: 'source', source: raw.document });
  expectCode(() => applyEvent(root, { revision: 0, type: 'source', source: raw.interview }), 'STALE_REVISION');
  assert.equal(Object.keys(loadState(root).sources).length, 1);
  fs.writeFileSync(path.join(root, 'write.lock'), 'other'); expectCode(() => send(root, { type: 'source', source: raw.interview }), 'RUN_BUSY'); fs.unlinkSync(path.join(root, 'write.lock'));
  fs.writeFileSync(path.join(root, 'state.json'), 'broken'); expectCode(() => loadState(root), 'STATE_UNREADABLE');
});
test('产物路径不能逃出 run', t => {
  const root = tmp(t); init(root); expectCode(() => inside(root, '../outside.md'), 'PATH_ESCAPE'); expectCode(() => inside(root, path.parse(root).root), 'PATH_ESCAPE');
});
test('远端交付记录文档版本，拒绝重复建文档和本机路径', t => {
  const root = tmp(t); reviewed(root); send(root, { type: 'artifact', stage: 'resolve', data: { commitments: [{ claimId: 'C-scope', status: 'preserved', quote: '本期只支持员工提交需求，不包含自动审批。' }] } }); advance(root);
  const d = send(root, { type: 'export', target: { space: 'example-space', docId: 'doc1', version: 'v1' } }).result;
  has(loadState(root), 'export', 'PUBLISH_PENDING');
  const receipt = { operationId: d.operationId, prdHash: d.prdHash, docId: 'other', version: 'v2', baseVersion: 'v1', url: 'https://example.test/doc1', remoteMarkdown: '文档' };
  expectCode(() => send(root, { type: 'publish-receipt', receipt }), 'DUPLICATE_DOCUMENT'); receipt.docId = 'doc1'; receipt.remoteMarkdown = '![图](C:\\local\\flow.svg)';
  expectCode(() => send(root, { type: 'publish-receipt', receipt }), 'REMOTE_LOCAL_PATH');
  receipt.remoteMarkdown = '![图](attachment://flow1)'; receipt.attachments = d.attachments.map(a => ({ id: a.id, hash: a.hash, reference: 'attachment://flow1' }));
  send(root, { type: 'publish-receipt', receipt }); send(root, { type: 'publish-receipt', receipt }); assert.equal(check(loadState(root)).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, d.manifestFile), 'utf8')).receipt.version, 'v2');
  const repeated = send(root, { type: 'export', target: { space: 'example-space', docId: 'doc1', version: 'v1' } }).result;
  assert.equal(repeated.operationId, d.operationId); assert.equal(repeated.receipt.version, 'v2');
  receipt.version = 'v3'; expectCode(() => send(root, { type: 'publish-receipt', receipt }), 'RECEIPT_CHANGED');
});
test('Windows 常见 UTF-8 BOM JSON 可以输入 CLI', t => {
  const root = tmp(t), file = path.join(root, 'config.json');
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify({ title: '中文任务', host: { runtimeId: 'host', authorSessionId: 'author' } }));
  assert.equal(main(['init', root, file]).title, '中文任务');
});
test('再次导出可恢复损坏交付包且不重复产品流程', t => {
  const root = tmp(t); reviewed(root); send(root, { type: 'artifact', stage: 'resolve', data: { commitments: [{ claimId: 'C-scope', status: 'preserved', quote: '本期只支持员工提交需求，不包含自动审批。' }] } }); advance(root);
  const d = send(root, { type: 'export' }).result; advance(root); assert.equal(loadState(root).stage, 'done');
  fs.writeFileSync(path.join(root, d.files.find(f => f.path.endsWith('PRD.md')).path), '损坏');
  assert.ok(inspectRun(root).issues.some(i => i.code === 'DELIVERY_CHANGED'));
  const restored = send(root, { type: 'export' }).result; assert.equal(restored.operationId, d.operationId); assert.equal(loadState(root).stage, 'export'); assert.equal(inspectRun(root).ok, true);
});
test('stdio bridge 实际创建新进程并传最小包，非法/失败返回不当作评审通过', async t => {
  const root = tmp(t); buildToReview(root); const p = prepare(root), r = mockResult(root, p);
  const bridge = path.join(root, 'bridge.mjs');
  fs.writeFileSync(bridge, `let input='';for await(const c of process.stdin)input+=c;const request=JSON.parse(input);if(request.packet.requestId!==${JSON.stringify(p.requestId)})process.exit(9);process.stdout.write(JSON.stringify(${JSON.stringify(r)}));`);
  const result = await executeBridge(root, loadState(root).revision, { command: process.execPath, args: [bridge], runtimeId: 'fixture-host', model: 'fixture-model' });
  assert.equal(result.result.isolation, 'verified'); assert.equal(loadState(root).reviews.length, 1);
  const failed = tmp(t); buildToReview(failed); prepare(failed);
  await assert.rejects(() => executeBridge(failed, loadState(failed).revision, { command: process.execPath, args: ['-e', 'process.exit(3)'], runtimeId: 'fixture-host', model: 'fixture-model' }), e => e.code === 'BRIDGE_FAILED');
  assert.equal(loadState(failed).reviews.length, 0); assert.equal(loadState(failed).reviewRequests[0].status, 'failed');
});
