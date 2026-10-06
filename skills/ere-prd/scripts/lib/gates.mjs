import { hash, textValue, idValue } from './store.mjs';

export const STAGES = ['intake', 'discovery', 'solution', 'specification', 'visuals', 'review', 'resolve', 'export', 'done'];
export const CORE = ['user', 'problem', 'goal', 'scope', 'flow', 'constraints'];
export const RUBRICS = {
  intake: ['source_coverage', 'evidence_fidelity'],
  discovery: ['information_sufficiency', 'demand_calibration'],
  solution: ['smallest_value_loop', 'alternatives_and_tradeoffs', 'commitment_alignment'],
  specification: ['cold_reader_clarity', 'observable_acceptance', 'exceptions_and_recovery', 'conditional_contracts'],
  visuals: ['visual_value', 'visual_consistency', 'visual_readability'],
  review: [],
  resolve: ['issue_resolution', 'commitment_alignment'],
  export: ['portable_delivery', 'target_compatibility']
};
const order = stage => STAGES.indexOf(stage);
const flat = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(flat).join('\n') : value && typeof value === 'object' ? Object.values(value).map(flat).join('\n') : String(value ?? '');
export const sourceBasis = s => hash(Object.values(s.sources).map(x => [x.id, x.version, x.hash]).sort((a, b) => a[0].localeCompare(b[0])));
export const reviewBasis = s => hash({ prd: s.draft?.hash, sources: sourceBasis(s), specification: hash(s.artifacts.specification ?? null),
  assets: s.diagrams.filter(x => x.prdHash === s.draft?.hash).map(x => [x.file, x.hash, x.sourceHash, x.caption]).sort((a,b) => a[0].localeCompare(b[0])) });
export function basis(s, stage = s.stage) {
  return hash({ sources: sourceBasis(s), artifacts: Object.fromEntries(Object.entries(s.artifacts).filter(([k]) => order(k) <= order(stage))),
    draft: order(stage) >= order('specification') ? s.draft?.hash : null,
    diagrams: order(stage) >= order('visuals') ? s.diagrams : null,
    reviews: order(stage) >= order('review') ? s.reviews : null,
    decisions: order(stage) >= order('resolve') ? s.decisions : null,
    delivery: stage === 'export' ? s.delivery : null });
}

// Validate collection shapes before any nested iteration. Incomplete semantic
// fields remain repairable gate issues, while malformed JSON cannot crash checks.
export function artifactShapeIssues(stage, a) {
  const issues = [], object = x => x && typeof x === 'object' && !Array.isArray(x);
  const list = (value, loc, rows = true) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || (rows && value.some(x => !object(x)))) { issues.push({ code: 'ARTIFACT_FORMAT', location: loc, message: '此字段需要数组，记录项需要对象。', repair: '按 harness 数据契约修正结构。' }); return []; }
    return value;
  };
  if (!object(a)) return [{ code: 'ARTIFACT_FORMAT', location: stage, message: '阶段产物需要对象。', repair: '提交对象。' }];
  if (stage === 'intake') {
    for (const c of list(a.coverage, 'coverage')) list(c.units, 'coverage/units');
    for (const c of list(a.claims, 'claims')) list(c.evidence, 'claims/evidence');
    for (const c of list(a.conflicts, 'conflicts')) { list(c.claimIds, 'conflict/claimIds', false); list(c.resolutionClaimIds, 'conflict/resolutionClaimIds', false); }
  }
  if (stage === 'discovery') { if (a.core !== undefined && !object(a.core)) issues.push({ code: 'ARTIFACT_FORMAT', location: 'core', message: 'core 需要对象。', repair: '填六项核心维度。' }); list(a.questions, 'questions'); }
  if (stage === 'solution') { list(a.inScope, 'inScope', false); list(a.nonGoals, 'nonGoals', false); list(a.alternatives, 'alternatives'); }
  if (stage === 'specification') {
    for (const r of list(a.requirements, 'requirements')) {
      list(r.acceptance, 'acceptance'); list(r.edges, 'edges'); list(r.claimIds, 'claimIds', false);
      for (const key of ['ai', 'permission']) if (r[key] !== undefined && !object(r[key])) issues.push({ code: 'ARTIFACT_FORMAT', location: `${r.id}/${key}`, message: '条件评估需要对象。', repair: '填写 applicable 与 reason。' });
      list(r.ai?.evaluations, 'ai/evaluations');
    }
    list(a.edgeAssessment, 'edgeAssessment'); list(a.openItems, 'openItems');
  }
  if (stage === 'visuals') list(a.decisions, 'decisions');
  if (stage === 'resolve') list(a.commitments, 'commitments');
  return issues;
}

export function check(s, stage = s.stage) {
  const issues = [], warnings = [];
  const add = (code, location, message, repair) => issues.push({ code, location, message, repair });
  const required = (value, loc) => { if (!textValue(value)) add('MISSING_VALUE', loc, '缺少具体内容。', '补入来源支持的内容，或明确未决项及其影响。'); };
  const a = s.artifacts[stage];
  for (const [key, value] of Object.entries(s.artifacts)) issues.push(...artifactShapeIssues(key, value));
  if (issues.length) return { stage, ok: false, issues, warnings, basis: basis(s, stage) };
  const claim = (ref, loc) => {
    if (!s.artifacts.intake?.claims?.some(x => x.id === ref)) add('UNKNOWN_CLAIM', loc, `找不到证据/假设 ${ref}。`, '先在 intake 登记并关联当前来源。');
  };
  const cited = (refs, loc) => {
    if (!Array.isArray(refs) || !refs.length) add('MISSING_PROVENANCE', loc, '缺少事实、假设或建议的引用。', '引用 intake 中的 claim ID；假设也要登记。');
    else refs.forEach(x => claim(x, loc));
  };
  if (!STAGES.includes(stage) || stage === 'done') return { stage, ok: stage === 'done', issues, warnings, basis: basis(s, stage) };
  if (stage !== 'review' && stage !== 'resolve' && stage !== 'export' && !a) add('NO_ARTIFACT', stage, '本阶段没有产物。', '提交对应阶段的结构化产物。');

  if (stage === 'intake' && a) {
    if (!Object.keys(s.sources).length) add('NO_SOURCE', 'sources', '尚未登记任何文档或访谈资料。', '将用户消息或文档作为 source 登记。');
    const coverage = a.coverage ?? [];
    for (const src of Object.values(s.sources)) {
      const cov = coverage.find(x => x.sourceId === src.id && x.sourceHash === src.hash);
      if (!cov) { add('SOURCE_NOT_CONSIDERED', src.id, '资料未纳入当前判断。', '为该资料逐单元记录使用/相关缺失/有理由跳过。'); continue; }
      for (const unit of src.units) {
        const row = cov.units?.find(x => x.id === unit.id);
        if (!row || !['used', 'irrelevant', 'unread'].includes(row.disposition)) add('UNCOVERED_UNIT', `${src.id}/${unit.id}`, '文档单元没有处理记录。', '读该页、表格或图片后登记；无关内容需写理由。');
        else if (row.disposition === 'used' && unit.read === false) add('FALSE_READ_RECEIPT', `${src.id}/${unit.id}`, '未读取的单元被标记为已使用。', '先实际读取再登记。');
        else if (row.disposition === 'unread' && row.material !== false) add('MATERIAL_UNREAD', `${src.id}/${unit.id}`, '与需求有关的资料尚未读到。', '调用合适 reader skill，或明确此缺口会阻止哪些结论。');
        else if (row.disposition !== 'used') required(row.reason, `${src.id}/${unit.id}/reason`);
      }
    }
    const claims = a.claims ?? [], ids = new Set();
    for (const c of claims) {
      if (!idValue(c.id) || ids.has(c.id)) add('CLAIM_ID', String(c.id), 'claim ID 无效或重复。', '使用唯一稳定 ID。'); ids.add(c.id);
      required(c.text, `${c.id}/text`);
      if (!['fact', 'assumption', 'proposal'].includes(c.kind)) add('CLAIM_KIND', c.id, '必须区分事实、假设和建议。', '设置 kind。');
      if (c.kind === 'fact') {
        if (!Array.isArray(c.evidence) || !c.evidence.length) add('UNSOURCED_FACT', c.id, '事实没有原始依据。', '关联来源版本、单元、原文引用。');
        for (const ev of c.evidence ?? []) {
          const src = s.sources[ev.sourceId], unit = src?.units.find(x => x.id === ev.unitId);
          if (!src || ev.sourceHash !== src.hash || !unit || !textValue(ev.quote) || !unit.text.includes(ev.quote)) add('INVALID_EVIDENCE', c.id, '来源已变更、位置错误或引用不在原文中。', '重读当前资料并更新引用；不得编造摘录。');
        }
      } else { required(c.reason, `${c.id}/reason`); required(c.validation, `${c.id}/validation`); }
    }
    for (const conflict of a.conflicts ?? []) {
      cited(conflict.claimIds, `${conflict.id}/claims`);
      if (conflict.material && conflict.status !== 'resolved') add('MATERIAL_CONFLICT', conflict.id, '影响目标、范围或主流程的资料冲突尚未解决。', '比较权威范围/版本/适用场景；必要时向用户询问。');
      if (conflict.status === 'resolved') { required(conflict.resolution, `${conflict.id}/resolution`); cited(conflict.resolutionClaimIds, `${conflict.id}/resolutionClaims`); }
    }
  }

  if (stage === 'discovery' && a) {
    for (const key of CORE) {
      const value = a.core?.[key];
      if (!value || !['sufficient', 'provisional', 'critical_gap'].includes(value.status)) add('CORE_STATUS', key, '核心维度未完成信息充分性判断。', '结合文档和访谈填写状态及内容。');
      else {
        required(value.summary, key); cited(value.claimIds, key);
        if (value.status === 'critical_gap') add('CRITICAL_GAP', key, '不同答案将改变核心方向，暂不能锁定方案。', '提出最有价值的一个问题，或给出有依据的分支草稿。');
        if (value.status === 'provisional') { required(value.validation, `${key}/validation`); warnings.push({ code: 'PROVISIONAL', location: key, message: '可进入草稿，但尚未验证。' }); }
      }
    }
    required(a.demandAssessment, 'demandAssessment');
    for (const q of a.questions ?? []) {
      required(q.question, q.id); required(q.materialImpact, `${q.id}/materialImpact`);
      if (!['answered', 'open', 'deferred'].includes(q.status)) add('QUESTION_STATUS', q.id, '问题状态无效。', '标记 answered/open/deferred。');
      if ((q.attempts ?? 0) >= 2 && q.status === 'open' && !q.newEvidence) add('INTERVIEW_LOOP', q.id, '重复追问已没有新信息。', '转成明确的假设、验证任务或用户待决项，停止原样追问。');
      if (q.status === 'deferred') { required(q.validation, `${q.id}/validation`); required(q.impact, `${q.id}/impact`); }
    }
  }

  if (stage === 'solution' && a) {
    required(a.valueLoop, 'valueLoop'); cited(a.claimIds, 'solution/claimIds');
    if (!Array.isArray(a.inScope) || !a.inScope.length) add('EMPTY_SCOPE', 'inScope', '没有本期范围。', '围绕最小价值闭环收窄。');
    if (!Array.isArray(a.nonGoals) || !a.nonGoals.length) add('NO_BOUNDARY', 'nonGoals', '没有说明本期不做什么。', '明确相邻而易膨胀的范围。');
    required(a.choice, 'choice'); required(a.tradeoff, 'tradeoff');
    if (!Array.isArray(a.alternatives) || a.alternatives.length < 2) add('NO_ALTERNATIVE', 'alternatives', '尚未比较可行路径。', '比较推荐路径与一个真实可选路径，可包括保持现状/人工验证。');
    for (const option of a.alternatives ?? []) { required(option.description, 'alternative'); required(option.fit, 'alternative/fit'); required(option.costOrRisk, 'alternative/costOrRisk'); }
  }

  if (stage === 'specification' && a) {
    const reqs = a.requirements ?? [], ids = new Set();
    if (!reqs.length) add('NO_REQUIREMENT', 'requirements', '没有具体需求。', '逐条描述用户可观察行为。');
    for (const r of reqs) {
      if (!idValue(r.id) || ids.has(r.id)) add('REQUIREMENT_ID', String(r.id), '需求 ID 无效或重复。', '使用唯一稳定 ID。'); ids.add(r.id);
      for (const field of ['title', 'actor', 'trigger', 'behavior', 'outcome']) required(r[field], `${r.id}/${field}`);
      cited(r.claimIds, r.id);
      if (!['P0', 'P1', 'P2'].includes(r.priority)) add('PRIORITY', r.id, '需求优先级无效。', '填写优先级及其理由。');
      required(r.priorityReason, `${r.id}/priorityReason`);
      if (!Array.isArray(r.acceptance) || !r.acceptance.length) add('NO_ACCEPTANCE', r.id, '没有验收方式。', '补充前置条件、触发、可观察结果与验证方式。');
      for (const ac of r.acceptance ?? []) for (const key of ['given', 'when', 'then', 'verify', 'verifier']) required(ac[key], `${r.id}/acceptance/${key}`);
      for (const edge of r.edges ?? []) for (const key of ['scenario', 'behavior', 'recovery']) required(edge[key], `${r.id}/edge/${key}`);
      for (const key of ['permission', 'ai']) {
        if (typeof r[key]?.applicable !== 'boolean') add('CONDITIONAL_ASSESSMENT', `${r.id}/${key}`, '未判断此条件是否适用。', '明确 applicable 及判断理由；不要默默省略。');
        required(r[key]?.reason, `${r.id}/${key}/reason`);
      }
      if (r.permission?.applicable) for (const key of ['allowed', 'denied']) required(r.permission[key], `${r.id}/permission/${key}`);
      if (r.ai?.applicable) {
        for (const key of ['normal', 'refusal', 'abstention', 'fallback']) required(r.ai[key], `${r.id}/ai/${key}`);
        if (!r.ai.evaluations?.length) add('NO_AI_EVAL', r.id, '模型行为没有对应评测。', '为正常、拒答、不确定及分步失败定义评测和阈值依据。');
        for (const ev of r.ai.evaluations ?? []) for (const key of ['behavior', 'method', 'threshold', 'rationale', 'slices']) required(ev[key], `${r.id}/ai/evaluation/${key}`);
        for (const behavior of ['normal', 'refusal', 'abstention', 'fallback']) if (!r.ai.evaluations?.some(e => e.behavior === behavior)) add('AI_EVAL_COVERAGE', `${r.id}/ai/${behavior}`, '已定义模型行为缺少对应评测。', '按 behavior 标识关联评测与切片，不编造通过率。');
      }
    }
    required(a.mainFlow, 'mainFlow');
    if (s.draft?.exploratory === true) add('EXPLORATORY_DRAFT', 'draft', '当前文本仍是可选路径探索草稿。', '完成确定的行为与验收，再重新登记非探索的 PRD。');
    if (!Array.isArray(a.edgeAssessment) || !a.edgeAssessment.length) add('NO_EDGE_ASSESSMENT', 'edgeAssessment', '没有评估关键异常类别。', '按具体场景判断权限、并发、空状态、依赖失败和恢复是否适用。');
    for (const e of a.edgeAssessment ?? []) { required(e.category, 'edge/category'); required(e.reason, 'edge/reason'); if (e.applicable && !e.requirementIds?.length) add('UNOWNED_EDGE', e.category, '适用异常没有关联需求。', '关联描述异常处理的需求 ID。'); }
    if (typeof a.handoff?.applicable !== 'boolean') add('CONDITIONAL_ASSESSMENT', 'handoff', '未评估独立执行契约。', '明确是否需要交给陌生执行者及原因。');
    required(a.handoff?.reason, 'handoff/reason');
    if (a.handoff?.applicable) {
      for (const key of ['authority', 'conflictRule', 'boundaries', 'stopConditions', 'owner']) required(a.handoff[key], `handoff/${key}`);
    }
    if (!s.draft || s.draft.sourceBasis !== sourceBasis(s) || s.draft.specHash !== hash(a)) add('DRAFT_STALE', 'draft', 'PRD 缺失或不对应当前资料/结构化需求。', '重新写出并登记 PRD 与需求引用映射。');
    else {
      for (const r of reqs) {
        const m = s.draft.mapping.find(x => x.requirementId === r.id);
        if (!m || !textValue(m.quote) || !s.draft.text.includes(m.quote)) add('DRAFT_REQUIREMENT_MISSING', r.id, '结构化需求没有落实到 PRD。', '在 PRD 写出对应行为，登记原文片段。');
      }
      for (const open of a.openItems ?? []) {
        required(open.question, open.id); required(open.impact, `${open.id}/impact`); required(open.owner, `${open.id}/owner`);
        if (!textValue(open.quote) || !s.draft.text.includes(open.quote)) add('HIDDEN_OPEN_ITEM', open.id, '未决项未出现在 PRD 中。', '向读者明确暴露问题及其影响。');
      }
    }
  }

  if (stage === 'visuals' && a) {
    if (!Array.isArray(a.decisions)) add('NO_VISUAL_DECISION', 'visuals', '尚未判断哪些内容需要图。', '逐个候选记录图/列表/表格的选择和理由；允许无需图。');
    for (const d of a.decisions ?? []) {
      for (const key of ['id', 'purpose', 'choice', 'reason']) required(d[key], `visual/${d.id}/${key}`);
      if (d.choice === 'diagram') {
        const render = s.diagrams.find(x => x.id === d.id && x.prdHash === s.draft?.hash);
        if (!render) add('DIAGRAM_UNRENDERED', d.id, '需要的图尚未实际生成或版本已过期。', '调用 render 或可用的图表 skill，保存图与可编辑源文件。');
        if (!d.qa || d.qa.readable !== true || d.qa.consistent !== true || !textValue(d.qa.evidence)) add('DIAGRAM_NOT_INSPECTED', d.id, '图未完成视觉检查与文图一致性检查。', '实际查看图片，检查中文、箭头、路径、数值、标签和正文。');
      } else if (!['list', 'table', 'none'].includes(d.choice)) add('VISUAL_CHOICE', d.id, '选择应为 diagram/list/table/none。', '选择最清楚的表达形式。');
    }
  }

  if (stage === 'review') {
    const latest = s.reviews.filter(x => x.prdHash === s.draft?.hash && x.contextHash === reviewBasis(s)).at(-1);
    if (!latest) add('NO_INDEPENDENT_REVIEW', 'review', '当前版本没有独立评审结果。', '封装 PRD 后由当前 host 新会话执行；不能回到作者上下文自审。');
    else if (latest.isolation !== 'verified') add('ISOLATION_UNVERIFIED', 'review', '只验证了部分隔离条件。', '由 host 证明没有继承历史、自动记忆、检索及越界工具输入；否则保留草稿和隔离限制。');
  }

  if (stage === 'resolve') {
    const findings = new Map(s.reviews.flatMap(r => r.findings.map(f => [f.id, f])));
    for (const [id, f] of findings) {
      const d = s.decisions.find(x => x.findingId === id);
      if (!d) { add('UNRESOLVED_FINDING', id, '评审意见没有处置。', '逐条接受、证据反驳或列为用户待决项。'); continue; }
      required(d.reason, `${id}/reason`);
      if (!['accepted', 'rebutted', 'deferred', 'user_decision'].includes(d.action)) add('RESOLUTION_ACTION', id, '评审处置无效。', '填写有效 action。');
      if (['deferred', 'user_decision'].includes(d.action) && f.severity === 'blocker') add('REVIEW_BLOCKER', id, '影响理解或实现的阻断意见仍未解决。', '修复并复审，或交付带缺口的草稿。');
      if (d.action === 'accepted' && (!textValue(d.quote) || !s.draft?.text.includes(d.quote))) add('FIX_NOT_IN_PRD', id, '已接受的修改未在当前 PRD 中找到。', '修改 PRD 并提供实际原文；影响行为时重新走需求闸门。');
      if (d.action === 'rebutted' && !d.claimIds?.length) add('UNSUPPORTED_REBUTTAL', id, '反驳缺少可追溯依据。', '提交证据 claim 或明确逻辑依据的 proposal。');
      for (const ref of d.claimIds ?? []) claim(ref, id);
    }
    for (const c of s.artifacts.intake?.claims ?? []) if (c.commitment === true) {
      const alignment = s.artifacts.resolve?.commitments?.find(x => x.claimId === c.id);
      if (!alignment || alignment.status !== 'preserved' || !textValue(alignment.quote) || !s.draft?.text.includes(alignment.quote)) add('COMMITMENT_ERODED', c.id, '已确认的核心承诺缺少保留证据。', '恢复原承诺，或将用户的明确变更作为新来源登记后重新构建。');
    }
    if (!s.reviews.some(r => r.prdHash === s.draft?.hash && r.contextHash === reviewBasis(s) && r.isolation === 'verified')) add('FINAL_UNREVIEWED', 'draft', '最终稿没有完成独立复审。', '对当前稿提交新的有限上下文评审；旧盲审保留不改写。');
    const latest = s.reviews.filter(r => r.prdHash === s.draft?.hash && r.contextHash === reviewBasis(s)).at(-1);
    if (latest?.findings.some(f => f.severity === 'blocker') || latest?.overall.readable === false) add('FINAL_REVIEW_BLOCKER', 'review', '最新评审仍认为存在阻断问题。', '修改或按具体意见提供证据并复审；作者单方面反驳不能放行。');
    for (const x of s.artifacts.specification?.openItems ?? []) if (x.material) add('HANDOFF_OPEN_ITEM', x.id, '仍有影响研发执行的未决项。', '回答后重新校验，或标为草稿交付。');
    if (Object.values(s.artifacts.discovery?.core ?? {}).some(x => x.status !== 'sufficient')) warnings.push({ code: 'UNVALIDATED_DEMAND', message: '需求仍含暂定假设，交付不等于市场验证通过。' });
  }
  if (stage === 'export') {
    if (!s.delivery || s.delivery.prdHash !== s.draft?.hash) add('NO_DELIVERY', 'delivery', '当前 PRD 没有可移植交付包。', '先 export 输出 Markdown、图片、源文件及清单。');
    if (s.delivery?.target && !s.delivery.receipt) add('PUBLISH_PENDING', 'delivery', '目标空间写入尚未确认。', '保留本地产物；通过可写 connector skill 获取目标文档 ID、版本和附件回执。');
  }
  return { stage, ok: issues.length === 0, issues, warnings, basis: basis(s, stage) };
}

export function semanticIssues(s, report) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message, repair: '重读当前产物，逐项提交有原文依据的语义判断。' });
  if (report.basis !== basis(s)) add('QUALITY_STALE', '语义判断与当前阶段或版本不匹配。');
  const available = `${flat(s.artifacts)}\n${s.draft?.text ?? ''}`;
  for (const key of RUBRICS[s.stage] ?? []) {
    const row = Array.isArray(report.checks) ? report.checks.find(x => x?.id === key) : null;
    if (!row) { add('QUALITY_MISSING', `缺少 ${key} 的判断。`); continue; }
    if (!['pass', 'provisional', 'fail', 'not_applicable'].includes(row.status)) add('QUALITY_STATUS', `${key} 状态无效。`);
    if (!textValue(row.reason)) add('QUALITY_REASON', `${key} 没有说明判断依据。`);
    if (!Array.isArray(row.anchors) || !row.anchors.length || row.anchors.some(x => !textValue(x) || !available.includes(x))) add('QUALITY_ANCHOR', `${key} 未引用实际产物片段。`);
    if (row.status === 'fail') add('QUALITY_FAILED', `${key} 尚未达标：${row.reason}`);
    if (row.status === 'provisional' && !['discovery', 'solution'].includes(s.stage)) add('QUALITY_PROVISIONAL', `${key} 暂定状态只能用于进入草稿。`);
    if (row.status === 'not_applicable' && !['conditional_contracts', 'visual_readability', 'visual_consistency', 'target_compatibility'].includes(key)) add('QUALITY_CANNOT_SKIP', `${key} 不能直接跳过。`);
  }
  return issues;
}
