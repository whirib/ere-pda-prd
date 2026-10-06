import fs from 'node:fs';
import path from 'node:path';
import { initRun, applyEvent } from '../skills/ere-prd/scripts/lib/harness.mjs';
import { loadState, hash } from '../skills/ere-prd/scripts/lib/store.mjs';
import { RUBRICS, basis } from '../skills/ere-prd/scripts/lib/gates.mjs';

// Fictional raw materials for tests and the offline demo. No research or live
// independent model review is implied by this fixture's successful run.
export const raw = {
  document: { id: 'D1', kind: 'document', title: '需求提交改进 brief（虚构）', locator: 'fixture://brief', version: '1', reader: 'text-reader', units: [{ id: 'body', locator: '全文', text: '员工在内部需求页面填写标题和描述并提交申请。本期只支持员工提交需求，不包含自动审批。信息完整时进入待处理；信息不完整时返回补充。保存失败保留输入，允许重试；重复点击不得产生两份记录。只有登录员工可以提交。' }] },
  interview: { id: 'I1', kind: 'interview', title: 'PM 访谈（虚构）', locator: 'fixture://interview', version: '1', reader: 'host-message', units: [{ id: 'turn1', locator: '访谈第 1 轮', text: '现在员工在群里发需求，PM 经常需要再问一次内容。希望提交后能清楚看到是否已进入待处理。成功标准是员工完成一次提交后能确认需求已收到，失败时知道如何继续。暂无量化基线，先观察提交任务完成情况。' }] }
};
export const prd = `# 内部需求提交 PRD（虚构示例）

## 概述
员工在内部需求页面填写标题和描述并提交申请，减少群聊中重复补问。当前需求来自 brief 与 PM 访谈，尚未开展真实用户观察。

## 目标与范围
员工完成一次提交后能确认需求已收到，失败时知道如何继续。暂无量化基线，先观察提交任务完成情况。
本期只支持员工提交需求，不包含自动审批。

## 主流程
填写需求 → 提交申请 → 判断信息完整。信息完整时进入待处理，信息不完整时返回补充。保存失败保留输入，允许重试。
![需求提交分支与恢复](diagrams/submit-flow.svg)

## 需求与验收
FR-01：只有登录员工可以提交。员工填写标题和描述后点击“提交申请”，信息完整时进入待处理并显示已收到；信息不完整时返回补充。
信息完整指标题和描述去除首尾空白后均非空。
验收：已登录员工填写完整信息并提交后，看到已收到及待处理状态；缺少标题、缺少描述或只填写空格时仍留在填写页，提示补充，原输入保留。QA 通过页面操作验证这些分支。
FR-02：保存失败保留输入，允许重试；重复点击不得产生两份记录。
验收：保存失败时输入仍可见，点击重试成功后仅有一份需求；QA 模拟失败与重复提交检查记录数。
另外模拟服务端已保存但成功响应丢失：员工重试后最终仅有一份需求，页面显示已收到。

## 权限、依赖与风险
未登录用户先登录再提交。现有登录和记录保存能力由内部平台提供；若接口行为与本文冲突，产品负责人和平台负责人先确定行为后实现。
产品负责人验证范围；QA 验证每条需求。权限或数据丢失问题不得按默认行为绕过。
本文决定范围及行为，既有接口文档决定数据协议；两者冲突时停止相关实现，由产品负责人和平台负责人共同确定行为后继续。不得修改既有登录机制，它由平台维护。
主要风险：保存失败恢复未按定义处理，会让员工丢失已填内容。验证方式：模拟保存失败后完成重试。

## 来源
需求提交改进 brief v1；PM 访谈第 1 轮。均为虚构演示材料。
`;

export const graph = { id: 'submit-flow', type: 'flowchart', title: '需求提交分支与恢复', purpose: '看清完整/不完整和保存失败后的路径', reason: '有条件分支与重试，线性列表会隐藏去向', requirementIds: ['FR-01', 'FR-02'],
  nodes: [{ id: 'fill', label: '填写需求', x: 400, y: 110 }, { id: 'submit', label: '提交申请', x: 400, y: 250 }, { id: 'checkInfo', label: '信息完整', kind: 'decision', x: 400, y: 390 },
    { id: 'received', label: '进入待处理', kind: 'terminal', x: 400, y: 690 }, { id: 'fix', label: '返回补充', x: 750, y: 390 }, { id: 'retry', label: '保存失败', x: 750, y: 550 }],
  edges: [{ from: 'fill', to: 'submit' }, { from: 'submit', to: 'checkInfo' }, { from: 'checkInfo', to: 'received', label: '完整且保存成功' }, { from: 'checkInfo', to: 'fix', label: '不完整' }, { from: 'fix', to: 'fill', label: '补齐后' }, { from: 'checkInfo', to: 'retry', label: '完整但保存失败' }, { from: 'retry', to: 'submit', label: '保留输入重试' }] };

export const mapping = [{ requirementId: 'FR-01', quote: 'FR-01：只有登录员工可以提交。员工填写标题和描述后点击“提交申请”，信息完整时进入待处理并显示已收到；信息不完整时返回补充。' },
  { requirementId: 'FR-02', quote: 'FR-02：保存失败保留输入，允许重试；重复点击不得产生两份记录。' }];

export function send(root, event) { return applyEvent(root, { ...event, revision: loadState(root).revision }); }
export function demonstrationQuality(s) {
  // Offline demonstration only. Real agents must make independent semantic
  // judgments; this function deliberately lives OUTSIDE the installed skill.
  const anchor = s.artifacts[s.stage]?.mainFlow ?? s.artifacts[s.stage]?.valueLoop ?? s.artifacts.intake?.claims[0]?.text ?? '示例';
  return { basis: basis(s), checks: (RUBRICS[s.stage] ?? []).map(id => ({ id, status: 'pass', reason: '离线 fixture 展示数据契约；这不是实际模型质量评估。', anchors: [anchor] })) };
}
export function advance(root) { return send(root, { type: 'advance', quality: demonstrationQuality(loadState(root)) }); }
export function intakeArtifact(s) {
  const evidence = (sourceId, quote) => [{ sourceId, sourceHash: s.sources[sourceId].hash, unitId: sourceId === 'D1' ? 'body' : 'turn1', quote }];
  return { coverage: Object.values(s.sources).map(x => ({ sourceId: x.id, sourceHash: x.hash, units: x.units.map(u => ({ id: u.id, disposition: 'used' })) })),
    claims: [{ id: 'C-user', kind: 'fact', text: '员工在内部需求页面填写标题和描述并提交申请。', evidence: evidence('D1', '员工在内部需求页面填写标题和描述并提交申请。') },
      { id: 'C-scope', kind: 'fact', text: '本期只支持员工提交需求，不包含自动审批。', commitment: true, evidence: evidence('D1', '本期只支持员工提交需求，不包含自动审批。') },
      { id: 'C-flow', kind: 'fact', text: '信息完整时进入待处理；信息不完整时返回补充。', evidence: evidence('D1', '信息完整时进入待处理；信息不完整时返回补充。') },
      { id: 'C-guard', kind: 'fact', text: '保存失败保留输入，允许重试；重复点击不得产生两份记录。', evidence: evidence('D1', '保存失败保留输入，允许重试；重复点击不得产生两份记录。') },
      { id: 'C-goal', kind: 'fact', text: raw.interview.units[0].text, evidence: evidence('I1', raw.interview.units[0].text) }], conflicts: [] };
}
export const discovery = { core: {
  user: { status: 'sufficient', summary: '登录员工在内部需求页提交申请', claimIds: ['C-user'] },
  problem: { status: 'sufficient', summary: '群聊需求内容不完整，PM 经常重复补问', claimIds: ['C-goal'] },
  goal: { status: 'sufficient', summary: '完成后明确需求已收到，失败时知道怎样继续；基线暂未测量', claimIds: ['C-goal'] },
  scope: { status: 'sufficient', summary: '只提交需求，不自动审批', claimIds: ['C-scope'] },
  flow: { status: 'sufficient', summary: '填写、完整性检查、待处理/补充、失败重试', claimIds: ['C-flow', 'C-guard'] },
  constraints: { status: 'sufficient', summary: '登录员工；保存失败不丢输入、重复点击不重复创建', claimIds: ['C-user', 'C-guard'] }
}, demandAssessment: '业务 brief 明确要求，访谈提供当前流程；没有虚构付费或真实用户观察证据。', questions: [] };
export const solution = { valueLoop: '员工一次提交后知道需求已收到；失败保留输入继续完成', claimIds: ['C-user', 'C-goal', 'C-scope'], inScope: ['填写和完整性提示', '保存结果和重试'], nonGoals: ['自动审批'], choice: '结构化页面提交', tradeoff: '增加填写步骤以减少重复追问；暂不建设审批系统', alternatives: [
  { description: '继续群聊加固定消息模板', fit: '低频且由 PM 人工补齐', costOrRisk: '易遗漏状态，仍需反复追问' },
  { description: '结构化页面提交', fit: '员工需明确提交状态', costOrRisk: '需要接入已有登录和保存能力' }
] };
export const specification = { mainFlow: '填写需求 → 提交申请 → 信息完整时进入待处理；否则返回补充。保存失败保留输入重试。',
  requirements: [{ id: 'FR-01', title: '提交并得到明确反馈', actor: '登录员工', trigger: '点击提交申请', behavior: '检查标题及描述，信息完整则保存，不完整则提示补充', outcome: '显示已收到及待处理，或保留输入返回补充', priority: 'P0', priorityReason: '核心提交闭环', claimIds: ['C-user', 'C-flow'],
    acceptance: [{ given: '登录员工填写标题与描述', when: '提交申请', then: '进入待处理并显示已收到', verify: 'QA 页面操作并核对记录', verifier: 'QA' }, { given: '标题或描述去除首尾空白后为空', when: '提交申请', then: '返回补充且原输入保留', verify: 'QA 分别检查缺少标题、描述与空格输入', verifier: 'QA' }],
    edges: [{ scenario: '缺少描述', behavior: '提示补充，保留已填内容', recovery: '补齐后再次提交' }], permission: { applicable: true, reason: '员工登录控制提交入口', allowed: '登录员工提交', denied: '未登录先登录再提交' }, ai: { applicable: false, reason: '确定性表单行为不调用模型' } },
    { id: 'FR-02', title: '失败重试和重复提交', actor: '登录员工', trigger: '保存失败或重复点击', behavior: '保留输入，重试且只创建一份需求', outcome: '失败可恢复，成功无重复记录', priority: 'P0', priorityReason: '避免数据丢失及重复', claimIds: ['C-guard'],
      acceptance: [{ given: '模拟一次保存失败', when: '点击重试', then: '内容保留且成功只产生一份记录', verify: 'QA 模拟失败及重复点击，核对记录数', verifier: 'QA' }, { given: '服务端已保存，但成功响应丢失', when: '员工重试', then: '最终只有一份需求，页面显示已收到', verify: 'QA 模拟响应丢失后核对记录数和页面', verifier: 'QA' }], edges: [{ scenario: '保存失败', behavior: '保留输入并提示重试', recovery: '用户点击重试' }], permission: { applicable: false, reason: '沿用 FR-01 的登录入口，无额外角色规则' }, ai: { applicable: false, reason: '保存与重试不调用模型' } }],
  edgeAssessment: [{ category: '权限', applicable: true, reason: '只有登录员工可提交', requirementIds: ['FR-01'] }, { category: '空输入', applicable: true, reason: '描述缺失须提示补充', requirementIds: ['FR-01'] },
    { category: '并发和依赖失败', applicable: true, reason: '重复点击和保存失败影响闭环', requirementIds: ['FR-02'] }],
  handoff: { applicable: true, reason: '交给不熟悉访谈的研发执行', authority: '本文行为及范围；已有接口文档数据协议', conflictRule: '冲突先由产品与平台负责人确定', boundaries: '不修改既有登录机制，平台负责', stopConditions: '权限、数据保存或接口冲突', owner: '产品负责人和平台负责人' }, openItems: [] };

export function buildToReview(root) {
  initRun(root, { title: '内部需求提交（离线虚构示例）', host: { runtimeId: 'fixture-host', model: 'fixture-model', authorSessionId: 'fixture-author' } });
  for (const source of Object.values(raw)) send(root, { type: 'source', source });
  send(root, { type: 'artifact', stage: 'intake', data: intakeArtifact(loadState(root)) }); advance(root);
  send(root, { type: 'artifact', stage: 'discovery', data: discovery }); advance(root);
  send(root, { type: 'artifact', stage: 'solution', data: solution }); advance(root);
  send(root, { type: 'artifact', stage: 'specification', data: specification }); send(root, { type: 'draft', text: prd, mapping }); advance(root);
  send(root, { type: 'render', spec: graph });
  send(root, { type: 'artifact', stage: 'visuals', data: { decisions: [{ id: graph.id, purpose: graph.purpose, choice: 'diagram', reason: graph.reason, qa: { readable: true, consistent: true, evidence: '离线模拟查看回执；实际用户工作流必须另行查看图片。' } }] } }); advance(root);
  return loadState(root);
}
export function mockResult(root, packet, findings = []) {
  return { requestId: packet.requestId, packetHash: packet.packetHash, prdHash: packet.prdHash,
    runtimeReceipt: { runtimeId: 'fixture-host', model: 'fixture-model', sessionId: `fixture-review-${packet.round}`, freshContext: true, historyInherited: false, automaticMemory: false, retrieval: false,
      controlsVerifiedByHost: true, toolPolicy: 'none', toolCalls: [], inputs: packet.inputs },
    report: { understanding: { user: '登录员工', problem: '群聊中反复补问', goal: '提交结果清楚、失败能继续', scope: '需求提交，不自动审批', flow: '填写、保存、反馈/补充或重试' }, uncertainties: [], findings,
      overall: { readable: !findings.some(x => x.severity === 'blocker'), reason: '离线 fixture 的格式和版本测试；没有真实模型独立评审。' } } };
}
export function prepare(root, evidenceClaimIds = []) {
  const r = send(root, { type: 'prepare-review', evidenceClaimIds });
  return JSON.parse(fs.readFileSync(path.join(root, r.result.packetFile), 'utf8'));
}
