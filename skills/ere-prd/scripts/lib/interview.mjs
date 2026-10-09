import { hash, need, idValue, textValue } from './store.mjs';

export const CORE_KEYS = ['user', 'problem', 'goal', 'scope', 'flow', 'constraints'];
export const emptyInterview = () => ({ plan: null, rounds: [], resolutions: [], summary: null, confirmation: null, draftAuthorization: null });
const ledger = s => s.interview ?? emptyInterview();
const nodeHash = node => hash(node);
const evidenceValid = (s, ev) => {
  const source = s.sources[ev?.sourceId], unit = source?.units.find(x => x.id === ev.unitId);
  return !!source && source.hash === ev.sourceHash && unit?.read !== false && textValue(ev.quote) && unit?.text.includes(ev.quote);
};
const humanEvidence = (s, ev) => evidenceValid(s, ev) && s.sources[ev.sourceId].kind === 'interview' && s.sources[ev.sourceId].actor === 'user';
const authorizedEvidence = (s, ev) => humanEvidence(s, ev) || (evidenceValid(s, ev) && s.sources[ev.sourceId].kind === 'document' && s.sources[ev.sourceId].authority === 'decision');
const evidence = (s, refs, predicate = evidenceValid) => Array.isArray(refs) && refs.length > 0 && refs.every(ev => predicate(s, ev));

function nodeStates(s) {
  const i = ledger(s), nodes = i.plan?.nodes ?? [], states = new Map();
  function visit(node) {
    if (states.has(node.id)) return states.get(node.id);
    const parents = node.dependsOn.map(id => visit(nodes.find(n => n.id === id)));
    const prerequisiteHash = hash(parents.map(p => [p.id, p.status, p.value, p.signature]));
    const parentsReady = parents.every(p => p.status === 'answered' || p.status === 'inactive');
    let inactive = parents.some(p => p.status === 'inactive');
    if (node.when && parentsReady) inactive ||= states.get(node.when.decisionId)?.value !== node.when.equals;
    const r = i.resolutions.filter(x => x.decisionId === node.id).at(-1);
    const valid = r && r.nodeHash === nodeHash(node) && r.prerequisiteHash === prerequisiteHash &&
      evidence(s, r.evidence, node.kind === 'decision' ? authorizedEvidence : evidenceValid);
    const status = inactive ? 'inactive' : !parentsReady ? 'blocked' : valid ? r.status : 'open';
    const state = { id: node.id, kind: node.kind, material: node.material, coreKeys: node.coreKeys, status,
      value: valid ? r.value : undefined, prerequisiteHash, resolution: valid ? r : undefined,
      signature: hash({ node: nodeHash(node), prerequisiteHash, inactive, resolution: valid ? r : null }) };
    states.set(node.id, state); return state;
  }
  nodes.forEach(visit); return [...states.values()];
}

export function interviewBasis(s) {
  const i = ledger(s);
  return hash({ plan: i.plan, states: nodeStates(s).map(x => [x.id, x.status, x.signature]) });
}
export function interviewStatus(s) {
  const i = ledger(s), states = nodeStates(s), awaiting = i.rounds.filter(r => r.status === 'awaiting_user');
  const unresolved = states.filter(n => n.material && !['answered', 'inactive'].includes(n.status));
  const confirmation = i.confirmation;
  const confirmed = !!i.summary && confirmation?.summaryHash === i.summary.hash &&
    i.summary.basis === interviewBasis(s) && confirmation.basis === interviewBasis(s) &&
    evidence(s, confirmation.evidence, humanEvidence);
  const explorationAuthorized = !!i.draftAuthorization && i.draftAuthorization.basis === interviewBasis(s) &&
    evidence(s, i.draftAuthorization.evidence, humanEvidence);
  return { states, frontier: states.filter(n => ['open', 'unknown', 'deferred'].includes(n.status)),
    awaiting, unresolved, confirmed, explorationAuthorized };
}

export function interviewIssues(s) {
  const issues = [], add = (code, location, message) => issues.push({ code, location, message,
    repair: '读取 interview 状态；查证事实，只问已满足前置的决策，并等待真实回答。不得用暂定、推荐、沉默或待确认文案代替答案。' });
  if (!ledger(s).plan?.nodes.length) {
    add('INTERVIEW_PLAN_MISSING', 'interview/plan', '没有登记事实与决策依赖树，不能自认信息足够。'); return issues;
  }
  const status = interviewStatus(s);
  for (const round of status.awaiting) add('AWAITING_ANSWERS', round.id, '这一轮仍有未收到的用户回答。');
  for (const node of status.unresolved) add('UNRESOLVED_DECISION', node.id, '影响方案的事实或决策尚未解决。');
  if (!status.confirmed) add('UNCONFIRMED_UNDERSTANDING', 'interview/summary', '当前理解没有有效的用户确认或完整输入授权。');
  return issues;
}

function validatePlan(nodes) {
  need(Array.isArray(nodes) && nodes.length > 0, 'INTERVIEW_PLAN_FORMAT', '需要非空事实与决策树。');
  const ids = new Set();
  for (const n of nodes) {
    need(idValue(n.id) && !ids.has(n.id), 'INTERVIEW_PLAN_FORMAT', '节点 ID 必须唯一。'); ids.add(n.id);
    need(['fact', 'decision'].includes(n.kind) && typeof n.material === 'boolean' && textValue(n.topic) && textValue(n.why), 'INTERVIEW_PLAN_FORMAT', '每个节点需说明事实/决策、影响和为什么需要。');
    need(Array.isArray(n.coreKeys) && n.coreKeys.length && n.coreKeys.every(k => CORE_KEYS.includes(k)), 'INTERVIEW_PLAN_FORMAT', '节点需关联实际核心信息维度。');
    need(Array.isArray(n.dependsOn) && n.dependsOn.every(idValue), 'INTERVIEW_PLAN_FORMAT', '前置节点需为 ID 数组。');
  }
  for (const n of nodes) {
    need(n.dependsOn.every(id => ids.has(id) && id !== n.id), 'INTERVIEW_DEPENDENCY', '前置节点不存在或依赖自身。');
    if (n.when) need(n.dependsOn.includes(n.when.decisionId) && textValue(n.when.equals), 'INTERVIEW_DEPENDENCY', '分支条件需引用前置决策及具体选择。');
  }
  const done = new Set(), visiting = new Set();
  const visit = n => { need(!visiting.has(n.id), 'INTERVIEW_CYCLE', '决策依赖不能形成循环。'); if (done.has(n.id)) return;
    visiting.add(n.id); n.dependsOn.forEach(id => visit(nodes.find(x => x.id === id))); visiting.delete(n.id); done.add(n.id); };
  nodes.forEach(visit);
  need(CORE_KEYS.every(k => nodes.some(n => n.coreKeys.includes(k))), 'INTERVIEW_COVERAGE', '六项核心信息均需对应事实或决策节点；一个节点可覆盖多项，无固定问题数量。');
  need(nodes.some(n => n.material), 'INTERVIEW_PLAN_FORMAT', '不能将所有节点标为无实质影响来绕过理解确认。');
}

export function applyInterviewEvent(s, event) {
  s.interview ??= emptyInterview(); const i = s.interview;
  if (event.type === 'interview-plan') {
    validatePlan(event.nodes);
    const previous = i.plan?.nodes ?? [];
    const eroded = previous.some(old => old.material && (!event.nodes.some(n => n.id === old.id) || event.nodes.find(n => n.id === old.id).material !== true));
    need(!eroded || evidence(s, event.changeEvidence, humanEvidence), 'INTERVIEW_SCOPE_EROSION', '删除或降级重要决策需要用户依据，不能由作者自行标成不重要。');
    i.plan = { nodes: event.nodes }; i.summary = null; i.confirmation = null; i.draftAuthorization = null;
    return { planHash: hash(i.plan), frontier: interviewStatus(s).frontier.map(x => x.id) };
  }
  need(i.plan, 'INTERVIEW_PLAN_MISSING', '先登记事实与决策树。');
  if (event.type === 'interview-ask') {
    need(!interviewStatus(s).awaiting.length, 'INTERVIEW_ROUND_PENDING', '上一轮未答完，不能提前询问依赖它的下一轮。');
    need(idValue(event.id) && !i.rounds.some(r => r.id === event.id) && Array.isArray(event.questions) && event.questions.length, 'INTERVIEW_ROUND_FORMAT', '轮次需唯一 ID 和本轮问题。');
    const states = interviewStatus(s).states, seen = new Set();
    for (const q of event.questions) {
      const node = i.plan.nodes.find(n => n.id === q.decisionId), state = states.find(n => n.id === q.decisionId);
      need(node && node.kind === 'decision' && ['open', 'unknown', 'deferred'].includes(state.status), 'INTERVIEW_NOT_FRONTIER', '只向用户询问前置已解决的未决选择；环境事实应自行查证。');
      need(!seen.has(q.decisionId) && textValue(q.question) && textValue(q.recommendation) && textValue(q.rationale), 'INTERVIEW_ROUND_FORMAT', '每个问题需说明选择、暂定建议及其依据，不能把推荐当作答案。'); seen.add(q.decisionId);
      const previous = i.rounds.flatMap(r => r.questions).filter(x => x.decisionId === q.decisionId).at(-1);
      need(!previous || previous.question.trim() !== q.question.trim(), 'INTERVIEW_REPEAT', '没有新回答时不要原样重复询问；换具体实例或有差异的选项。');
    }
    i.rounds.push({ id: event.id, questions: event.questions, status: 'awaiting_user', askedRevision: s.revision + 1, answers: [] });
    i.summary = null; i.confirmation = null;
    return { waitingFor: event.questions.map(q => q.decisionId), nextAction: 'present_questions_and_wait' };
  }
  if (event.type === 'interview-resolve') {
    const node = i.plan.nodes.find(n => n.id === event.decisionId), state = interviewStatus(s).states.find(n => n.id === event.decisionId);
    need(node && state.status !== 'blocked' && state.status !== 'inactive', 'INTERVIEW_NOT_FRONTIER', '前置尚未解决，不能代替用户预填下游答案。');
    need(['answered', 'unknown', 'deferred'].includes(event.status) && textValue(event.value) && textValue(event.reason), 'INTERVIEW_RESOLUTION_FORMAT', '需记录真实回答/未知/延期、具体内容及理解依据。');
    need(evidence(s, event.evidence, node.kind === 'decision' ? authorizedEvidence : evidenceValid), 'INTERVIEW_EVIDENCE', '事实需当前来源；决策需用户原话或有决策权的文档，模型建议不算。');
    const round = i.rounds.find(r => r.status === 'awaiting_user' && r.questions.some(q => q.decisionId === node.id));
    if (round) need(evidence(s, event.evidence, humanEvidence) && event.evidence.every(ev => s.sources[ev.sourceId].registeredRevision > round.askedRevision), 'INTERVIEW_ANSWER_ORDER', '提问后的回答必须来自后续真实用户来源，不能复用初始 brief 或推荐答案。');
    if (!round && node.kind === 'decision' && event.status === 'answered') need(event.evidence.some(ev => ev.quote.includes(event.value)), 'INTERVIEW_INFERRED_CHOICE', '复用既有材料时，选定值需直接出现在原文依据中；解释出的新选择要作为问题交给用户。');
    const resolution = { decisionId: node.id, status: event.status, value: event.value, reason: event.reason, evidence: event.evidence,
      nodeHash: nodeHash(node), prerequisiteHash: state.prerequisiteHash, resolvedRevision: s.revision + 1, method: round ? 'answer' : 'source' };
    i.resolutions.push(resolution);
    if (round) { round.answers.push({ decisionId: node.id, resolutionRevision: resolution.resolvedRevision });
      if (round.questions.every(q => round.answers.some(a => a.decisionId === q.decisionId))) round.status = 'complete'; }
    i.summary = null; i.confirmation = null; i.draftAuthorization = null;
    return { decisionId: node.id, status: event.status, frontier: interviewStatus(s).frontier.map(x => x.id) };
  }
  if (event.type === 'interview-summary') {
    const status = interviewStatus(s);
    need(!status.awaiting.length && !status.unresolved.length, 'INTERVIEW_NOT_READY', '仍有重要未决项或未回答问题，不能宣布已达成共同理解。');
    need(textValue(event.text), 'INTERVIEW_SUMMARY_FORMAT', '总结当前目标、范围、选择及仍未知的事实，呈现给用户检查。');
    const summary = { text: event.text, basis: interviewBasis(s), presentedRevision: s.revision + 1 }; summary.hash = hash(summary);
    i.summary = summary; i.confirmation = null; return { summaryHash: summary.hash, nextAction: 'present_summary_and_wait' };
  }
  if (event.type === 'interview-confirm') {
    need(i.summary && i.summary.hash === event.summaryHash && i.summary.basis === interviewBasis(s), 'INTERVIEW_SUMMARY_STALE', '只能确认当前决策树对应的总结。');
    need(evidence(s, event.evidence, humanEvidence), 'INTERVIEW_EVIDENCE', '共同理解的确认需实际用户原话。');
    if (event.mode === 'provided-input') {
      need(!i.rounds.length && interviewStatus(s).states.filter(n => n.material && n.status !== 'inactive').every(n => n.resolution?.method === 'source'), 'INTERVIEW_INPUT_AUTHORIZATION', '只有完整输入已回答重要决策、且未产生新采访选择时，才可复用用户明确的按材料执行授权。');
    } else {
      need(event.mode === 'response' && event.evidence.every(ev => s.sources[ev.sourceId].registeredRevision > i.summary.presentedRevision), 'INTERVIEW_CONFIRMATION_ORDER', '新产生的共同理解需呈现后用户确认；沉默、等待时长、初始请求均不是确认。');
    }
    i.confirmation = { summaryHash: i.summary.hash, basis: interviewBasis(s), mode: event.mode, evidence: event.evidence };
    return { confirmed: true };
  }
  if (event.type === 'interview-draft-authorize') {
    need(evidence(s, event.evidence, humanEvidence) && textValue(event.reason), 'INTERVIEW_EVIDENCE', '跳过未决项先看探索稿，需要用户明确要求及原文依据。');
    i.draftAuthorization = { basis: interviewBasis(s), evidence: event.evidence, reason: event.reason };
    return { exploratoryOnly: true, unresolved: interviewStatus(s).unresolved.map(n => n.id) };
  }
  if (event.type === 'interview-resume') {
    need(idValue(event.roundId) && evidence(s, event.evidence, humanEvidence), 'INTERVIEW_EVIDENCE', '放弃或重开未答轮次必须有用户明确改变工作方式的原话。');
    const round = i.rounds.find(r => r.id === event.roundId && r.status === 'awaiting_user');
    need(round, 'INTERVIEW_ROUND_FORMAT', '待答轮次不存在。');
    round.status = 'cancelled_by_user'; round.cancellationEvidence = event.evidence;
    i.summary = null; i.confirmation = null; i.draftAuthorization = null;
    return { nextAction: 'recompute_frontier', unresolved: interviewStatus(s).unresolved.map(n => n.id) };
  }
  need(false, 'UNKNOWN_EVENT', `未知采访操作 ${event.type}。`);
}
