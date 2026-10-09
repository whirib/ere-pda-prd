import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initRun, inspectRun } from '../skills/ere-prd/scripts/lib/harness.mjs';
import { loadState } from '../skills/ere-prd/scripts/lib/store.mjs';
import { check } from '../skills/ere-prd/scripts/lib/gates.mjs';
import { interviewStatus, CORE_KEYS } from '../skills/ere-prd/scripts/lib/interview.mjs';
import { send, advance, buildToReview, solution } from '../examples/fixture.mjs';

const testTemp = path.resolve(process.env.ERE_PRD_TEST_TMP ?? os.tmpdir());
fs.mkdirSync(testTemp, { recursive: true });
const temp = t => { const root = fs.mkdtempSync(path.join(testTemp,'ere-prd-interview-')); t.after(() => {
  assert.equal(path.dirname(path.resolve(root)),testTemp); assert.ok(path.basename(root).startsWith('ere-prd-interview-')); fs.rmSync(root,{recursive:true,force:true}); }); return root; };
const fails = (fn,code) => assert.throws(fn,e=>e.code===code);
const has = (s,code) => assert.ok(check(s,'discovery').issues.some(x=>x.code===code),JSON.stringify(check(s,'discovery')));
// Synthetic brief reproduces the shape of the observed failure, not real user research.
const brief = '我要迭代搜索结果页，加入底部语音按钮、多轮搜索、供需关系解释与引导，最终给我 PRD Markdown。';
const source = (id,text,actor='user') => ({id,kind:'interview',actor,title:'虚构采访 '+id,locator:'fixture://'+id,version:'1',reader:'fixture-user-message',units:[{id:'body',locator:'全文',text}]});
const ref = (root,id,quote) => ({sourceId:id,sourceHash:loadState(root).sources[id].hash,unitId:'body',quote:quote??loadState(root).sources[id].units[0].text});
function refreshIntake(root) {
  const s=loadState(root);
  send(root,{type:'artifact',stage:'intake',data:{coverage:Object.values(s.sources).map(src=>({sourceId:src.id,sourceHash:src.hash,units:[{id:'body',disposition:'used'}]})),
    claims:Object.values(s.sources).map(src=>({id:'C-'+src.id,kind:src.actor==='agent'?'proposal':'fact',text:src.units[0].text,
      ...(src.actor==='agent'?{reason:'模型建议，不是用户决定',validation:'必须由用户选择'}:{evidence:[ref(root,src.id)]})})),conflicts:[]}});
  advance(root);
}
function nodes() { return [
  {id:'context',kind:'fact',topic:'已知的改版目标',material:false,coreKeys:CORE_KEYS,dependsOn:[],why:'仅登记 brief 中已有的方向，不补造用户研究'},
  {id:'scope',kind:'decision',topic:'首期业务范围',material:true,coreKeys:['scope'],dependsOn:[],why:'改变条件与供给口径'},
  {id:'voice',kind:'decision',topic:'语音入口及交互方式',material:true,coreKeys:['flow'],dependsOn:['scope'],why:'避免把跟随态擅自解释为某种录音流程'},
  {id:'result',kind:'decision',topic:'需求与供给表达',material:true,coreKeys:['goal','flow'],dependsOn:['voice'],why:'结果关系依赖当前交互方式'},
  {id:'guide',kind:'decision',topic:'引导行为',material:true,coreKeys:['flow'],dependsOn:['result'],why:'示例必须和已确定能力相符'}
]; }
function discovery(root) { return {core:Object.fromEntries(CORE_KEYS.map(key=>[key,{status:'provisional',summary:'方向已知，真实行为证据尚待研究',uncertaintyType:'research',claimIds:['C-U0'],decisionIds:[key==='scope'?'scope':key==='flow'?'voice':'context'],validation:'任务观察验证；不替代重要交互决策'}])),demandAssessment:'虚构简短 brief；没有用户研究、没有暗定交互方案。',questions:[]}; }
function start(root) {
  initRun(root,{title:'采访顺序回归',host:{runtimeId:'fixture',authorSessionId:'author'}});
  send(root,{type:'source',source:source('U0',brief)});refreshIntake(root);
  send(root,{type:'interview-plan',nodes:nodes()});
  send(root,{type:'interview-resolve',decisionId:'context',status:'answered',value:'三项改版方向',reason:'初始 brief 已明确',evidence:[ref(root,'U0')]});
  send(root,{type:'artifact',stage:'discovery',data:discovery(root)});
}
const question = (id,text='请选择 '+id) => ({decisionId:id,question:text,recommendation:'暂建议 A，可选其他答案或还没想好',rationale:'具体取舍须由用户决定，不自动采用建议'});
function ask(root,id,round='round-'+id) { send(root,{type:'interview-ask',id:round,questions:[question(id)]}); }
function answer(root,id,value,status='answered') {
  const sourceId='U-'+id+'-'+loadState(root).revision;
  send(root,{type:'source',source:source(sourceId,value)});refreshIntake(root);
  send(root,{type:'interview-resolve',decisionId:id,status,value,reason:'仅按本轮虚构用户原话记录',evidence:[ref(root,sourceId)]});return sourceId;
}
function settle(root) { for(const [id,value] of [['scope','餐饮'],['voice','点击录音并检查文本'],['result','摘要加证据说明'],['guide','只在按钮旁给一条提示']]) {ask(root,id);answer(root,id,value);} }
function summary(root) {return send(root,{type:'interview-summary',text:'餐饮试点；点击录音并检查文本，摘要加证据说明，按钮旁一条提示；问题假设待研究。'}).result;}
function confirm(root,summaryHash) {
  send(root,{type:'source',source:source('U-confirm','确认，按这个理解写；研究假设继续标明。')});refreshIntake(root);
  send(root,{type:'interview-confirm',summaryHash,mode:'response',evidence:[ref(root,'U-confirm')]});
}

test('复现旧路径：未回答范围、多个 provisional、延期文案均不能推进',t=>{
  const root=temp(t);start(root);ask(root,'scope');
  const a=discovery(root);a.questions=[{id:'Q1',decisionId:'scope',question:'首期范围？',materialImpact:'影响方案',attempts:1,status:'deferred',validation:'后续确认',impact:'以后补业务适配'}];
  send(root,{type:'artifact',stage:'discovery',data:a});
  has(loadState(root),'AWAITING_ANSWERS');has(loadState(root),'UNRESOLVED_DECISION');has(loadState(root),'QUESTION_UNGROUNDED');
  const revision=loadState(root).revision;fails(()=>advance(root),'GATE_BLOCKED');assert.equal(loadState(root).revision,revision);
  for(const value of Object.values(a.core))value.status='sufficient';send(root,{type:'artifact',stage:'discovery',data:a});
  fails(()=>advance(root),'GATE_BLOCKED');assert.equal(loadState(root).stage,'discovery');
});
test('同一轮不能把依赖未答的下游问题提前问，也不能边等待边开下一轮',t=>{
  const root=temp(t);start(root);
  fails(()=>send(root,{type:'interview-ask',id:'bad',questions:[question('scope'),question('voice')]}),'INTERVIEW_NOT_FRONTIER');
  assert.equal(loadState(root).interview.rounds.length,0);ask(root,'scope');
  fails(()=>ask(root,'voice'),'INTERVIEW_ROUND_PENDING');
  fails(()=>send(root,{type:'interview-resolve',decisionId:'voice',status:'answered',value:'点击录音',reason:'猜测',evidence:[ref(root,'U0')]}),'INTERVIEW_NOT_FRONTIER');
});
test('初始 brief、模型推荐和旧来源不能伪装成提问后的用户回答',t=>{
  const root=temp(t);start(root);ask(root,'scope');
  fails(()=>send(root,{type:'interview-resolve',decisionId:'scope',status:'answered',value:'餐饮',reason:'默认推荐',evidence:[ref(root,'U0')]}),'INTERVIEW_ANSWER_ORDER');
  send(root,{type:'source',source:source('A1','建议选择餐饮','agent')});refreshIntake(root);
  fails(()=>send(root,{type:'interview-resolve',decisionId:'scope',status:'answered',value:'餐饮',reason:'模型推荐',evidence:[ref(root,'A1')]}),'INTERVIEW_EVIDENCE');
  assert.deepEqual(inspectRun(root).interview.waitingFor,['scope']);
});
test('复用材料只能采用原文直接写出的选择，不可把解释当已确认方案',t=>{
  const root=temp(t);start(root);
  fails(()=>send(root,{type:'interview-resolve',decisionId:'scope',status:'answered',value:'餐饮',reason:'按经验推断',evidence:[ref(root,'U0')]}),'INTERVIEW_INFERRED_CHOICE');
});
test('真实回答只解锁对应下一层；未知或延期不算已解决',t=>{
  const root=temp(t);start(root);ask(root,'scope');answer(root,'scope','餐饮');
  assert.deepEqual(interviewStatus(loadState(root)).frontier.filter(n=>n.kind==='decision').map(n=>n.id),['voice']);
  ask(root,'voice');answer(root,'voice','还没想好','unknown');
  const state=interviewStatus(loadState(root));assert.equal(state.awaiting.length,0);assert.equal(state.states.find(n=>n.id==='result').status,'blocked');
  fails(()=>summary(root),'INTERVIEW_NOT_READY');fails(()=>advance(root),'GATE_BLOCKED');
  send(root,{type:'interview-ask',id:'voice-again',questions:[question('voice','先选入口用途：只是录音入口，还是表达持续对话？')]});answer(root,'voice','先放着，待讨论','deferred');
  has(loadState(root),'UNRESOLVED_DECISION');
});
test('部分回答不会关闭同轮其他独立问题',t=>{
  const root=temp(t);start(root);const plan=nodes();plan.push({id:'independent',kind:'decision',topic:'试点成功目标',material:true,coreKeys:['goal'],dependsOn:[],why:'独立于交互分支'});
  send(root,{type:'interview-plan',nodes:plan});
  send(root,{type:'interview-ask',id:'roots',questions:[question('scope'),question('independent')]});answer(root,'scope','餐饮');
  assert.deepEqual(inspectRun(root).interview.waitingFor,['independent']);fails(()=>ask(root,'voice'),'INTERVIEW_ROUND_PENDING');
});
test('全部回答后仍需呈现总结，再收到用户确认；原请求不能代替确认',t=>{
  const root=temp(t);start(root);settle(root);const out=summary(root);
  fails(()=>send(root,{type:'interview-confirm',summaryHash:out.summaryHash,mode:'response',evidence:[ref(root,'U0')]}),'INTERVIEW_CONFIRMATION_ORDER');
  fails(()=>send(root,{type:'interview-confirm',summaryHash:out.summaryHash,mode:'provided-input',evidence:[ref(root,'U0')]}),'INTERVIEW_INPUT_AUTHORIZATION');
  fails(()=>advance(root),'GATE_BLOCKED');confirm(root,out.summaryHash);
  send(root,{type:'artifact',stage:'discovery',data:discovery(root)});advance(root);assert.equal(loadState(root).stage,'solution');
});
test('探索稿不再是默认逃生门：明确用户要求可以导出但不推进',t=>{
  const root=temp(t);start(root);ask(root,'scope');
  const draft={type:'draft',exploratory:true,text:'# 探索稿\n范围与交互未定，列出分支，不宣称可开工。',mapping:[]};
  fails(()=>send(root,draft),'INTERVIEW_BLOCKED');
  send(root,{type:'source',source:source('U-draft','先看探索草稿，把未决分支写清楚；不用替我决定。')});refreshIntake(root);
  send(root,{type:'interview-draft-authorize',reason:'用户明确先看分支探索稿',evidence:[ref(root,'U-draft')]});send(root,draft);
  const out=send(root,{type:'draft-export'}).result;assert.equal(out.status,'draft');assert.equal(loadState(root).stage,'discovery');
  fails(()=>advance(root),'GATE_BLOCKED');assert.ok(out.missing.some(x=>x.code==='AWAITING_ANSWERS'));
});
test('删除或降级重要未决节点不能由作者静默操作',t=>{
  const root=temp(t);start(root);const changed=nodes();changed.find(n=>n.id==='voice').material=false;
  fails(()=>send(root,{type:'interview-plan',nodes:changed}),'INTERVIEW_SCOPE_EROSION');
});
test('有条件的分支由已收到的用户选择激活，不用预猜所有答案',t=>{
  const root=temp(t);start(root);const plan=nodes();plan.push({id:'other-business',kind:'decision',topic:'综合搜索跨业务条件',material:true,coreKeys:['scope'],dependsOn:['scope'],when:{decisionId:'scope',equals:'综合'},why:'仅综合分支需要'});
  send(root,{type:'interview-plan',nodes:plan});ask(root,'scope');answer(root,'scope','餐饮');
  assert.equal(interviewStatus(loadState(root)).states.find(n=>n.id==='other-business').status,'inactive');
});
test('环境事实不能转嫁给用户问；前置事实未完成时只等其下游',t=>{
  const root=temp(t);start(root);
  const plan=[...nodes(),{id:'interface',kind:'fact',topic:'本地可查的接口字段',material:true,coreKeys:['constraints'],dependsOn:[],why:'由 agent 检查文件'},
    {id:'data-display',kind:'decision',topic:'供给数据展示',material:true,coreKeys:['flow'],dependsOn:['interface'],why:'依赖已查明的数据能力'}];
  send(root,{type:'interview-plan',nodes:plan});
  const states=interviewStatus(loadState(root));
  assert.ok(states.frontier.some(n=>n.id==='interface'));assert.ok(states.frontier.some(n=>n.id==='scope'));
  assert.equal(states.states.find(n=>n.id==='data-display').status,'blocked');
  fails(()=>send(root,{type:'interview-ask',id:'fact-round',questions:[question('interface')]}),'INTERVIEW_NOT_FRONTIER');
  ask(root,'scope');assert.deepEqual(inspectRun(root).interview.waitingFor,['scope']);
});
test('答案依据版本变化后，旧答案、依赖答案和共同理解会失效',t=>{
  const root=temp(t);start(root);settle(root);const out=summary(root);confirm(root,out.summaryHash);
  const src=Object.values(loadState(root).sources).find(x=>x.id.startsWith('U-scope'));
  send(root,{type:'source',source:{...src,version:'2',units:[{id:'body',locator:'全文',text:'改成综合搜索'}]}});refreshIntake(root);
  const state=interviewStatus(loadState(root));assert.equal(state.confirmed,false);assert.equal(state.states.find(n=>n.id==='scope').status,'open');assert.equal(state.states.find(n=>n.id==='voice').status,'blocked');
});
test('方案 choice 必须对应已确认具体选择，不接受作者新推荐',t=>{
  const root=temp(t);buildToReview(root);const s=loadState(root);s.artifacts.solution={...solution,choice:'改成聊天页'};
  assert.ok(check(s,'solution').issues.some(x=>x.code==='SOLUTION_UNCONFIRMED_CHOICE'));
});
test('旧 run 没有采访账本时不能沿用过去的 pass 自动继续',t=>{
  const root=temp(t);buildToReview(root);const s=loadState(root);delete s.interview;
  assert.ok(check(s,'review').issues.some(x=>x.code==='INTERVIEW_PLAN_MISSING'));
});
test('完整已确认材料可复用明确授权，不强制凑采访问题数量',t=>{
  const root=temp(t);buildToReview(root);const s=loadState(root);
  assert.equal(s.interview.rounds.length,0);assert.equal(interviewStatus(s).confirmed,true);assert.equal(s.stage,'review');
});
test('依赖循环和缺失节点被拒绝，不能造成无穷等待或隐式补值',t=>{
  const root=temp(t);start(root);const plan=nodes();plan.find(n=>n.id==='scope').dependsOn=['voice'];
  fails(()=>send(root,{type:'interview-plan',nodes:plan}),'INTERVIEW_CYCLE');
  plan.find(n=>n.id==='scope').dependsOn=['missing'];fails(()=>send(root,{type:'interview-plan',nodes:plan}),'INTERVIEW_DEPENDENCY');
});
