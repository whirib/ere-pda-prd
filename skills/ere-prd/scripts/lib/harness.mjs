import fs from 'node:fs';
import path from 'node:path';
import { hash, need, textValue, idValue, atomicWrite, inside, transaction, loadState } from './store.mjs';
import { STAGES, check, semanticIssues, sourceBasis, basis, artifactShapeIssues } from './gates.mjs';
import { packetFor, validateReview } from './review.mjs';
import { renderDiagram } from './visuals.mjs';
import { emptyInterview, applyInterviewEvent, interviewIssues, interviewStatus, interviewBasis } from './interview.mjs';

const index = stage => STAGES.indexOf(stage);
const writeJson = (root, file, value) => atomicWrite(inside(root, file), JSON.stringify(value, null, 2));
const requireStage = (s, names) => need(names.includes(s.stage), 'WRONG_STAGE', `当前阶段 ${s.stage}，该操作需要 ${names.join('/')}。`);

export function initRun(root, { title, host, policy = {} }) {
  need(textValue(title) && textValue(host?.runtimeId) && textValue(host?.authorSessionId), 'INIT_CONFIG', '请提供标题、当前 host ID、作者会话 ID；可记录当前模型。');
  fs.mkdirSync(root, { recursive: true });
  const stateFile = inside(root, 'state.json');
  need(!fs.existsSync(stateFile), 'RUN_EXISTS', 'run 已存在。请恢复现有 run 或使用新目录，不覆盖。');
  const effective = { maxReviewRounds: 3, maxReviewCalls: 6, debateContextChars: 12000, ...policy };
  need(Number.isInteger(effective.maxReviewRounds) && effective.maxReviewRounds >= 1 && effective.maxReviewRounds <= 3, 'POLICY', '自动评审轮数必须在 1–3 之间。');
  need(Number.isInteger(effective.maxReviewCalls) && effective.maxReviewCalls >= effective.maxReviewRounds && effective.maxReviewCalls <= 8, 'POLICY', '评审调用预算必须包含有限失败重试，最多 8 次。');
  need(Number.isInteger(effective.debateContextChars) && effective.debateContextChars >= 1000 && effective.debateContextChars <= 24000, 'POLICY', '讨论上下文预算无效。');
  const state = { schema: 1, title, host, policy: effective, revision: 0, stage: 'intake', createdAt: new Date().toISOString(),
    sources: {}, artifacts: {}, gates: {}, interview: emptyInterview(), draft: null, diagrams: [], reviews: [], reviewRequests: [], decisions: [], delivery: null, log: [] };
  // Exclusive create prevents two initializers from overwriting one another.
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
  return state;
}

function invalidate(s, stage, reason) {
  for (const key of Object.keys(s.gates)) if (index(key) >= index(stage)) delete s.gates[key];
  if (index(s.stage) > index(stage)) s.stage = stage;
  s.delivery = null;
  if (index(stage) <= index('visuals')) for (const r of s.reviewRequests.filter(x => x.status === 'pending')) r.status = 'stale';
  s.log.push({ event: 'invalidated', from: stage, reason, at: new Date().toISOString() });
}

function verifyFiles(root, s, includeDelivery = true) {
  const issues = [];
  for (const d of s.diagrams.filter(x => x.prdHash === s.draft?.hash)) for (const [file, expected] of [[d.file, d.hash], [d.sourceFile, d.sourceHash]]) {
    try { if (hash(fs.readFileSync(inside(root, file))) !== expected) issues.push({ code: 'ASSET_CHANGED', location: file, message: '图表/源文件缺失或被改动。', repair: '重新渲染并检查。' }); }
    catch { issues.push({ code: 'ASSET_MISSING', location: file, message: '图表/源文件不可读。', repair: '重新渲染并检查。' }); }
  }
  if (s.delivery && includeDelivery) {
    try { if (hash(JSON.parse(fs.readFileSync(inside(root, s.delivery.manifestFile), 'utf8'))) !== hash(s.delivery)) issues.push({ code: 'DELIVERY_MANIFEST_CHANGED', location: s.delivery.manifestFile, message: '交付清单与当前版本/回执不一致。', repair: '从当前状态重新导出或恢复有效清单。' }); }
    catch { issues.push({ code: 'DELIVERY_MANIFEST_MISSING', location: 'delivery.json', message: '交付清单不可读。', repair: '恢复当前版本的交付清单。' }); }
    for (const f of s.delivery.files) {
      try { if (hash(fs.readFileSync(inside(root, f.path))) !== f.hash) issues.push({ code: 'DELIVERY_CHANGED', location: f.path, message: '交付包被修改。', repair: '从当前 PRD 重新导出。' }); }
      catch { issues.push({ code: 'DELIVERY_MISSING', location: f.path, message: '交付文件不可读。', repair: '重新导出。' }); }
    }
  }
  return issues;
}

export function inspectRun(root, stage) {
  const s = loadState(root), report = check(s, stage ?? s.stage);
  report.issues.push(...verifyFiles(root, s)); report.ok = report.issues.length === 0;
  const interview = interviewStatus(s);
  const nextAction = s.stage === 'intake' ? 'read_sources_and_update_intake' : !s.interview?.plan ? 'map_facts_and_decisions' :
    interview.awaiting.length ? 'await_user_answers' : interview.unresolved.length ? 'investigate_facts_or_ask_frontier' : !interview.confirmed ? 'present_summary_and_wait' : report.ok ? 'advance_current_stage' : 'repair_current_stage';
  return { ...report, revision: s.revision, stage: stage ?? s.stage, next: report.ok ? STAGES[index(s.stage) + 1] ?? null : null, nextAction,
    interview: { frontier: interview.frontier.map(n => ({ id: n.id, kind: n.kind, status: n.status })),
      waitingFor: interview.awaiting.flatMap(r => r.questions.filter(q => !r.answers.some(a => a.decisionId === q.decisionId)).map(q => q.decisionId)),
      unresolved: interview.unresolved.map(n => n.id), confirmed: interview.confirmed, exploratoryAuthorized: interview.explorationAuthorized } };
}

function deliver(root, s, draftOnly, target) {
  need(s.draft?.sourceBasis === sourceBasis(s), 'DRAFT_STALE', '不能导出与当前资料不匹配的草稿。');
  need(s.draft.interviewBasis === interviewBasis(s), 'DRAFT_INTERVIEW_STALE', '草稿与当前事实/决策树不一致；不能复用旧稿或旧采访闸门。');
  need(s.draft.exploratory ? interviewStatus(s).explorationAuthorized : !interviewIssues(s).length, 'INTERVIEW_BLOCKED', '探索稿需明确用户授权；普通稿需先完成关键决策与共同理解确认。');
  need(verifyFiles(root, s, false).length === 0, 'ASSET_CHANGED', '交付前请修复被修改或缺失的图表。');
  if (!draftOnly) requireStage(s, ['export', 'done']);
  if (!draftOnly) need(s.draft.exploratory !== true, 'EXPLORATORY_DRAFT', '探索草稿须重新完成 specification 并登记正式稿后才可正式交付。');
  const dir = `deliveries/${s.draft.hash.slice(0, 16)}-${draftOnly ? 'draft' : 'ready'}`;
  const files = [], attachments = [];
  let md = s.draft.text;
  for (const d of s.diagrams.filter(x => x.prdHash === s.draft.hash)) {
    const file = `${dir}/assets/${path.basename(d.file)}`, sourceFile = `${dir}/sources/${path.basename(d.sourceFile)}`;
    const bytes = fs.readFileSync(inside(root, d.file)), source = fs.readFileSync(inside(root, d.sourceFile));
    atomicWrite(inside(root, file), bytes); atomicWrite(inside(root, sourceFile), source);
    md = md.split(d.file).join(`assets/${path.basename(d.file)}`);
    files.push({ path: file, hash: hash(bytes) }, { path: sourceFile, hash: hash(source) });
    attachments.push({ id: d.id, path: `assets/${path.basename(d.file)}`, hash: d.hash, caption: d.caption, editableSource: `sources/${path.basename(d.sourceFile)}` });
  }
  // Exported documents remain useful even if review was unavailable. The status
  // is explicit and does not advance or erase the blocked quality gate.
  const pending = STAGES.filter(x => index(x) < index('export') && !s.gates[x]);
  const banner = draftOnly ? `> 草稿：尚未通过 ${pending.join('、') || '全部交付检查'}。具体缺口见 delivery.json。\n\n` : '';
  const prdPath = `${dir}/PRD.md`;
  atomicWrite(inside(root, prdPath), banner + md); files.push({ path: prdPath, hash: hash(banner + md) });
  const delivery = { schema: 1, title: s.title, status: draftOnly ? 'draft' : 'ready', prdHash: s.draft.hash, sourceBasis: sourceBasis(s),
    format: 'markdown', target: target ?? null, targetDocId: target?.docId ?? null, targetVersion: target?.version ?? null,
    operationId: hash({ hash: s.draft.hash, target: target ?? null, contents: files.map(f => [f.path.replace(dir, 'package'), f.hash]) }), attachments, files, pending,
    missing: draftOnly ? inspectState(s) : [], createdAt: new Date().toISOString(), receipt: null, manifestFile: `${dir}/delivery.json` };
  if (!draftOnly && s.delivery?.operationId === delivery.operationId) {
    delivery.createdAt = s.delivery.createdAt; delivery.receipt = s.delivery.receipt;
    delivery.targetDocId = s.delivery.targetDocId; delivery.targetVersion = s.delivery.targetVersion;
  }
  writeJson(root, `${dir}/delivery.json`, delivery);
  return delivery;
}
function inspectState(s) {
  // Future gates are listed in pending; don't call an unperformed commitment
  // assessment "eroded" or an unperformed review a finding in an early draft.
  return STAGES.slice(0, Math.min(index('export'), index(s.stage) + 1)).flatMap(stage => check(s, stage).issues);
}

export function applyEvent(root, event) {
  need(event && typeof event.type === 'string', 'EVENT_FORMAT', 'event 需要 type。');
  return transaction(root, event.revision, s => {
    let result = {};
    if (event.type === 'source') {
      const src = event.source;
      need(idValue(src?.id) && textValue(src.title) && textValue(src.locator) && textValue(src.version) && ['document', 'interview'].includes(src.kind), 'SOURCE_FORMAT', '来源需要 ID、标题、位置、版本及 document/interview 类型。');
      need(textValue(src.reader) && Array.isArray(src.units) && src.units.length, 'SOURCE_UNITS', '来源需要 reader 能力/skill 名及文档单元。');
      const ids = new Set();
      for (const unit of src.units) {
        need(unit && idValue(unit.id) && !ids.has(unit.id) && textValue(unit.locator) && typeof unit.text === 'string', 'SOURCE_UNIT', '来源单元需唯一 ID、可回定位的位置和抽取文本。'); ids.add(unit.id);
        need(unit.read === false || textValue(unit.text), 'SOURCE_EMPTY', '已读单元必须有实际抽取内容；未读请显式 read:false。');
      }
      need(src.actor === undefined || ['user', 'agent'].includes(src.actor), 'SOURCE_FORMAT', '访谈 actor 必须标明 user 或 agent。');
      need(src.authority === undefined || ['decision', 'reference'].includes(src.authority), 'SOURCE_FORMAT', '文档需区分决策权材料与参考资料。');
      const { hash: ignoredHash, registeredRevision: ignoredRevision, ...sourceData } = src;
      const normalized = { ...sourceData, hash: hash(sourceData), registeredRevision: s.revision + 1 };
      const previous = s.sources[src.id];
      if (previous?.hash !== normalized.hash) {
        if (previous) writeJson(root, `sources/${src.id}-${previous.hash}.json`, previous);
        s.sources[src.id] = normalized;
        writeJson(root, `sources/${src.id}-${normalized.hash}.json`, normalized);
        invalidate(s, 'intake', `资料 ${src.id} 已更新。`);
        for (const r of s.reviewRequests.filter(x => x.status === 'pending')) r.status = 'stale';
      }
      result = { sourceId: src.id, sourceHash: normalized.hash };
    } else if (event.type.startsWith('interview-')) {
      need(index(s.stage) >= index('discovery') || (s.stage === 'intake' && s.interview?.plan), 'WRONG_STAGE', '先读来源并完成 intake；回答新增来源返工 intake 时可登记已有采访的回答。');
      result = applyInterviewEvent(s, event);
      invalidate(s, 'discovery', '事实/决策树、真实回答或共同理解状态改变。');
    } else if (event.type === 'artifact') {
      const { stage, data } = event;
      need(['intake', 'discovery', 'solution', 'specification', 'visuals', 'resolve'].includes(stage) && index(stage) <= index(s.stage), 'ARTIFACT_STAGE', '不能跳过前置阶段直接提交后续产物。');
      need(data && typeof data === 'object' && !Array.isArray(data), 'ARTIFACT_FORMAT', '阶段产物必须是对象。');
      need(!artifactShapeIssues(stage, data).length, 'ARTIFACT_FORMAT', JSON.stringify(artifactShapeIssues(stage, data)));
      if (hash(s.artifacts[stage] ?? null) !== hash(data)) {
        invalidate(s, stage, '阶段产物已修改。'); s.artifacts[stage] = data;
        writeJson(root, `artifacts/${stage}-${hash(data)}.json`, data);
      }
    } else if (event.type === 'draft') {
      const exploratory = event.exploratory === true && index(s.stage) >= index('discovery');
      need((index(s.stage) >= index('specification') || exploratory) && textValue(event.text) && Array.isArray(event.mapping), 'DRAFT_FORMAT', '正式稿从 specification 登记；方向缺口仍在时可明确 exploratory:true 登记可选路径草稿。');
      need(exploratory ? interviewStatus(s).explorationAuthorized : !interviewIssues(s).length, 'INTERVIEW_BLOCKED', '用户未回答不等于默认同意；先完成关键决策和理解确认。先看探索稿须有明确用户原话授权。');
      if (s.draft?.hash !== hash(event.text) || hash(s.draft?.mapping) !== hash(event.mapping) || s.draft?.sourceBasis !== sourceBasis(s) || s.draft?.specHash !== hash(s.artifacts.specification ?? null) || s.draft?.interviewBasis !== interviewBasis(s) || s.draft?.exploratory !== exploratory) {
        invalidate(s, 'specification', 'PRD 文字或映射已修改，需要重新验证。');
        s.draft = { text: event.text, hash: hash(event.text), sourceBasis: sourceBasis(s), specHash: hash(s.artifacts.specification ?? null), interviewBasis: interviewBasis(s), mapping: event.mapping, exploratory };
        atomicWrite(inside(root, `drafts/${s.draft.hash}.md`), event.text);
      }
      result = { prdHash: s.draft.hash };
    } else if (event.type === 'render') {
      requireStage(s, ['visuals']);
      const rendered = renderDiagram(s, event.spec), id = event.spec.id;
      const file = `diagrams/${id}.svg`, sourceFile = `diagrams/${id}.${rendered.sourceExtension}`;
      atomicWrite(inside(root, file), rendered.svg); atomicWrite(inside(root, sourceFile), rendered.source);
      invalidate(s, 'visuals', '图表重新生成，需要实际查看。');
      const entry = { id, type: event.spec.type, prdHash: s.draft.hash, file, sourceFile, hash: hash(rendered.svg), sourceHash: hash(rendered.source), caption: event.spec.title, purpose: event.spec.purpose, width: rendered.width, height: rendered.height };
      s.diagrams = [...s.diagrams.filter(x => x.id !== id), entry]; result = entry;
    } else if (event.type === 'attach-diagram') {
      requireStage(s, ['visuals']);
      const d = event.diagram;
      need(idValue(d?.id) && textValue(d.caption) && textValue(d.purpose), 'DIAGRAM_FORMAT', '外部 renderer 回执需 ID、标题及目的。');
      const bytes = fs.readFileSync(inside(root, d.file)), source = fs.readFileSync(inside(root, d.sourceFile));
      need(bytes.length > 0 && source.length > 0 && hash(bytes) === d.hash && hash(source) === d.sourceHash, 'RENDER_RECEIPT', '图表或可编辑源文件与 renderer 回执不一致。');
      need(/\.(svg|png)$/i.test(d.file), 'RENDER_FORMAT', '便携配图请用 SVG 或 PNG。其他格式由输出 skill 转换后登记。');
      invalidate(s, 'visuals', '外部图表需要检查。');
      s.diagrams = [...s.diagrams.filter(x => x.id !== d.id), { ...d, prdHash: s.draft.hash }];
    } else if (event.type === 'prepare-review') {
      requireStage(s, ['review', 'resolve']);
      need(verifyFiles(root, s).length === 0, 'ASSET_CHANGED', '评审配图缺失或被改动。');
      const packet = packetFor(s, event.evidenceClaimIds ?? []);
      const folder = `review-inbox/${packet.requestId}`;
      atomicWrite(inside(root, `${folder}/PRD.md`), packet.prd.text);
      for (const asset of packet.assets) atomicWrite(inside(root, `${folder}/${asset.name}`), fs.readFileSync(inside(root, asset.name)));
      writeJson(root, `${folder}/packet.json`, packet);
      s.reviewRequests.push({ requestId: packet.requestId, packetHash: packet.packetHash, prdHash: packet.prdHash, file: `${folder}/packet.json`, status: 'pending', round: packet.round, mode: packet.mode });
      result = { requestId: packet.requestId, packetFile: `${folder}/packet.json`, packetHash: packet.packetHash, mode: packet.mode };
    } else if (event.type === 'review-result') {
      requireStage(s, ['review', 'resolve']);
      const req = s.reviewRequests.find(x => x.requestId === event.result?.requestId);
      need(req?.status === 'pending', 'REVIEW_NOT_PENDING', '评审请求不存在、已过期或已接收，首轮报告不可覆盖。');
      const packet = JSON.parse(fs.readFileSync(inside(root, req.file), 'utf8'));
      const { packetHash, ...packetBody } = packet;
      need(packetHash === req.packetHash && hash(packetBody) === req.packetHash, 'PACKET_CHANGED', '封存的评审包已被改动。');
      const review = validateReview(s, packet, event.result);
      writeJson(root, `reviews/${req.requestId}.json`, event.result);
      s.reviews.push(review); req.status = 'completed'; result = review;
    } else if (event.type === 'review-failed') {
      const req = s.reviewRequests.find(x => x.requestId === event.requestId);
      need(req?.status === 'pending' && textValue(event.reason), 'REVIEW_NOT_PENDING', '只有待执行的请求可以登记失败，且必须有原因。');
      req.status = 'failed'; req.reason = event.reason;
    } else if (event.type === 'decision') {
      requireStage(s, ['review', 'resolve']);
      const d = event.decision;
      need(s.reviews.some(r => r.findings.some(f => f.id === d?.findingId)) && textValue(d.reason), 'UNKNOWN_FINDING', '处置必须对应具体评审意见，并有理由。');
      s.decisions = [...s.decisions.filter(x => x.findingId !== d.findingId), d]; invalidate(s, 'resolve', '评审处置已更新。');
    } else if (event.type === 'export' || event.type === 'draft-export') {
      const delivery = deliver(root, s, event.type === 'draft-export', event.target);
      if (event.type === 'export') { if (s.stage === 'done') s.stage = 'export'; delete s.gates.export; s.delivery = delivery; }
      result = delivery;
    } else if (event.type === 'publish-receipt') {
      requireStage(s, ['export']);
      const d = s.delivery, r = event.receipt;
      need(d?.target && r?.operationId === d.operationId && r.prdHash === d.prdHash && textValue(r.docId) && textValue(r.version) && /^https?:\/\//.test(r.url), 'PUBLISH_RECEIPT', '发布回执需匹配操作 ID、PRD、目标文档 ID、版本和 URL。');
      if (d.targetDocId) need(r.docId === d.targetDocId, 'DUPLICATE_DOCUMENT', '更新既有文档不能返回另一份新文档 ID。');
      need(r.baseVersion === (d.target.version ?? null), 'TARGET_VERSION', '目标版本已变或缺少版本检查，重新读取后合并。');
      need(textValue(r.remoteMarkdown) && !/(?:(?<![A-Za-z])[A-Za-z]:[\\/]|file:\/\/|(?:^|\s|\()\\\\)/m.test(r.remoteMarkdown), 'REMOTE_LOCAL_PATH', '远端文档中仍包含本机路径。');
      for (const a of d.attachments) {
        const uploaded = r.attachments?.find(x => x.id === a.id && x.hash === a.hash);
        need(uploaded && textValue(uploaded.reference) && r.remoteMarkdown.includes(uploaded.reference), 'ATTACHMENT_NOT_UPLOADED', '远端文档必须使用已上传的附件引用，并校验图表版本。');
        need(!r.remoteMarkdown.includes(a.path), 'ATTACHMENT_LOCAL_REFERENCE', '远端文档仍引用本地交付包的附件路径，请替换成目标空间引用。');
      }
      const recorded = { ...r, remoteMarkdownHash: hash(r.remoteMarkdown) };
      need(!d.receipt || hash(d.receipt) === hash(recorded), 'RECEIPT_CHANGED', '同一交付操作不能登记不同结果；读取真实状态后作为新版本更新。');
      d.receipt = recorded; d.targetDocId = r.docId; d.targetVersion = r.version;
      writeJson(root, d.manifestFile, d);
    } else if (event.type === 'advance') {
      need(s.stage !== 'done', 'ALREADY_DONE', 'run 已完成；资料变更会自动使相关阶段失效。');
      const report = check(s), fileIssues = verifyFiles(root, s), semantic = semanticIssues(s, event.quality ?? {});
      const issues = [...report.issues, ...fileIssues, ...semantic];
      need(!issues.length, 'GATE_BLOCKED', JSON.stringify({ stage: s.stage, issues }, null, 2));
      s.gates[s.stage] = { basis: basis(s), at: new Date().toISOString(), quality: event.quality ?? {}, warnings: report.warnings };
      s.stage = STAGES[index(s.stage) + 1]; result = { next: s.stage, warnings: report.warnings };
    } else need(false, 'UNKNOWN_EVENT', `未知操作 ${event.type}。`);
    s.log.push({ event: event.type, revision: s.revision + 1, stage: s.stage, at: new Date().toISOString() });
    return result;
  });
}
