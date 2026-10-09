# Harness 操作与数据契约

脚本提供状态机和检查，不自动完成产品判断，也不自动调用模型。主 agent 阅读资料、访谈、生成产物并提交事件。核心无第三方依赖，Node.js 22+ 可用；整份 `ere-prd` 文件夹可以独立复制使用。

## 一次任务

以下命令中的路径换成实际绝对路径；输入 JSON 用 UTF-8 保存。任务目录放在用户允许写入的工作区。

```text
node <skill-dir>/scripts/prd.mjs init <run-dir> <config.json>
node <skill-dir>/scripts/prd.mjs status <run-dir>
node <skill-dir>/scripts/prd.mjs apply <run-dir> <event.json>
node <skill-dir>/scripts/prd.mjs check <run-dir>
node <skill-dir>/scripts/prd.mjs quality-template <run-dir>
```

`config.json`：

```json
{
  "title": "本次产品需求",
  "host": {"runtimeId": "当前运行环境", "authorSessionId": "实际作者会话ID", "model": "实际当前模型"},
  "policy": {"maxReviewRounds": 3, "maxReviewCalls": 6, "debateContextChars": 12000}
}
```

模型不可取得时省略 `model`，不能猜一个名称。host/session 由宿主工具或会话系统提供；不能用虚构会话 ID 掩盖复用作者上下文。默认评审轮数 3、调用数 6（含失败）；允许收紧。模型、图工具或输入 reader 不可用时，先完成可做部分。

每次写入读取最新 `revision`，事件带该值。CLI 成功输出 JSON；检查缺口退出码 2，执行错误为 1。API 可导入 `<skill-dir>/scripts/lib/harness.mjs` 的 `initRun/applyEvent/inspectRun` 与 `<skill-dir>/scripts/lib/store.mjs` 的 `loadState`。

API 路径相对于实际安装的 skill，不相对于项目 cwd。Windows 和其他平台可使用动态 import：

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const skillDir = '实际skill目录绝对路径';
const { initRun, applyEvent } = await import(pathToFileURL(path.join(skillDir, 'scripts/lib/harness.mjs')).href);
```

run-dir 同样建议使用绝对路径。调用脚本可以放在任何任务目录，不必放入 skill。JSON 输入支持 UTF-8 BOM，但 UTF-16 文件须先转 UTF-8。

```json
{"revision": 0, "type": "source", "source": {"id": "D1", "kind": "document", "title": "业务 brief", "locator": "用户给出的路径或空间链接", "version": "v1", "reader": "实际使用的reader名称", "units": [{"id": "body", "locator": "第1节", "text": "登录员工填写需求，提交成功后看到待处理状态。"}]}}
```

`source.kind` 表示证据渠道：`document` 或 `interview`；不限制文档格式/公司/reader。访谈消息同样登记 source。`id` 用 1–80 位字母/数字/下划线/连字符；ID 稳定，版本更新复用 ID。单元可以是页、节、表、图、批注、修订、附件。未读单元用 `read:false,text:""`，不得冒充抽取成功。reader 改变、位置改变或内容改变都会更新来源哈希。

用户消息添加 `actor:"user"`，模型建议使用 `actor:"agent"`，不能伪装成用户来源。实际有权决定需求的文档才添加 `authority:"decision"`，普通参考资料使用 reference 或省略。`registeredRevision` 由脚本记录，调用方不能用它预填回答顺序。详见 [采访与决策依赖契约](interview.md)。

## 阶段产物

提交方式统一为：

```json
{"revision": 1, "type": "artifact", "stage": "intake", "data": {"coverage": [{"sourceId": "D1", "sourceHash": "source事件返回的哈希", "units": [{"id": "body", "disposition": "used"}]}], "claims": [{"id": "C1", "kind": "fact", "text": "登录员工提交后看到待处理状态", "evidence": [{"sourceId": "D1", "sourceHash": "source事件返回的哈希", "unitId": "body", "quote": "提交成功后看到待处理状态"}]}], "conflicts": []}}
```

引用 `sourceHash` 必须取实际输出。不要把上面的占位值直接用于任务。每个事实的 quote 必须出现在对应版本和单元；脚本验证原文包含关系，主 agent 判断引用是否支持结论。

| 产物 | 字段与规则 |
|---|---|
| intake | `coverage[]` 按 source 与 units 覆盖；disposition 为 used/irrelevant/unread；后两种要 reason，unread 默认是相关缺口，明确 material:false 才可非阻断。`claims[]` 含 id/kind/text；fact 需 evidence；assumption/proposal 需 reason/validation；已确认承诺标 commitment:true。`conflicts[]` 含 id/material/status/claimIds；resolved 需 resolution/resolutionClaimIds。 |
| discovery | `core` 包含 user/problem/goal/scope/flow/constraints；每项 status（sufficient/provisional/critical_gap）、summary、claimIds、decisionIds；decisionIds 关联覆盖该维度的采访节点。provisional 需 validation 与 uncertaintyType（research/implementation/decision）。`demandAssessment` 写实际证据强弱。questions 为可选对照记录，answered/deferred 必须对应账本中的真实 resolution；手写这些标签不解决待答。 |
| solution | valueLoop、claimIds、inScope[]、nonGoals[]、choice、choiceDecisionId、tradeoff；choice 与 choiceDecisionId 指向的 answered 决策值一致。alternatives[] 至少包含推荐路径及一条真实可选路径，每项 description/fit/costOrRisk。推荐不能自动成为选定方案。 |
| specification | mainFlow、requirements[]、edgeAssessment[]、handoff、openItems[]；下文列出需求格式。关键未决项写进 PRD，不藏在状态文件中。 |
| visuals | decisions[]：id/purpose/choice/reason；choice 为 diagram/list/table/none；diagram 需实际渲染和 qa.readable/consistent=true、qa.evidence 记录实际查看所得。没有配图需要可用空 decisions，但语义判断仍解释选择。 |
| resolve | commitments[]：claimId/status:"preserved"/quote；quote 引用当前 PRD 中保留承诺的片段。处置意见另用 decision 事件。 |

discovery 的六项判断适用 [访谈标准](quality.md)及 [采访账本](interview.md)。不强制证明市场需求，但重要选择必须有依据，用户未答不能推进。已经从完整明确材料取得的答案可复用，不凑问题数量。先呈现总结并记录共同理解；只有完整材料与明确按材料执行授权才适用 provided-input。

`requirements[]` 每项：

```json
{
  "id": "FR-01", "title": "提交需求", "actor": "登录员工", "trigger": "点击提交",
  "behavior": "检查信息并保存", "outcome": "显示待处理状态",
  "priority": "P0", "priorityReason": "完成核心闭环", "claimIds": ["C1"],
  "acceptance": [{"given": "已登录且信息完整", "when": "提交", "then": "看到待处理", "verify": "操作页面并核对记录", "verifier": "QA"}],
  "edges": [{"scenario": "保存失败", "behavior": "保留输入并提示重试", "recovery": "用户重试"}],
  "permission": {"applicable": true, "reason": "入口需要登录", "allowed": "登录员工", "denied": "未登录先登录"},
  "ai": {"applicable": false, "reason": "确定性表单，不调用模型"}
}
```

permission/ai/handoff 必须明确适用与否和 reason。AI 适用时定义 normal/refusal/abstention/fallback，并为四类逐一提供 evaluations[]：behavior 使用这四个标识，method/threshold/rationale/slices 写可执行评测、阈值依据和样本切片。多步骤模型流程进一步覆盖组件失败，不能用一个最终通过率掩盖。

edgeAssessment[] 每项 category/applicable/reason；适用的异常要 requirementIds，关联实际处理它的需求。按场景评估权限、空状态、并发、依赖失败、恢复，不强制所有类别都有功能。handoff 适用时加 authority/conflictRule/boundaries/stopConditions/owner；不熟悉项目的执行者需知道哪些材料决定什么、冲突时找谁、哪些事不能擅自做。

openItems[]：id/question/impact/owner/quote/material；quote 必须出现在 PRD。material:true 可以保留在草稿，但阻止研发交付。

## PRD、图与闸门

specification 提交后登记 PRD：

```json
{"revision": 10, "type": "draft", "text": "PRD全文", "mapping": [{"requirementId": "FR-01", "quote": "PRD中实际包含该需求行为的片段"}]}
```

PRD 是人读的主产物，结构化记录是追溯和检查依据。mapping 不是章节标题映射；需要实际行为原文。draft 与当前 sources/specification 绑定，即使文本不变、依据变了也要重新登记。

discovery/solution 尚有关键缺口时，只有用户明确要求先看探索稿，引用原话登记 interview-draft-authorize 后，才可以提交 `exploratory:true,mapping:[]` 的 draft，把选择分支、未决问题及影响写进正文，再 draft-export。当前阶段不推进，探索稿不满足 specification，也不能正式 export。不要为了能交稿把 critical_gap 改成 sufficient、把未答改为 deferred 或复用初始“最终给我 PRD”作为探索授权。

图表使用 `{"type":"render","revision":11,"spec":{...}}`；数据契约见 [visuals.md](visuals.md)。外部工具使用 attach-diagram，diagram 含 id/caption/purpose/file/sourceFile/hash/sourceHash；路径在 run 内，实际 SVG/PNG 与可编辑源文件哈希一致。每个需要的图必须登记对应 decision。

`quality-template` 生成 advance 事件骨架。每项 checks 填 id/status/reason/anchors；anchors 引用阶段产物或 PRD 的实际片段。status 可为 pass/fail；discovery/solution 可为 provisional，只有明确不适用的条件契约/图检查/目标兼容可为 not_applicable。不要引用一个无关句子替整份产物背书。

```json
{"revision": 12, "type": "advance", "quality": {"basis": "quality-template的实际basis", "checks": [{"id": "source_coverage", "status": "pass", "reason": "逐页和访谈单元均处理，相关表格已读", "anchors": ["实际产物片段"]}]}}
```

实际模板会包含该阶段全部检查 ID。脚本检查结构、版本、引用、完整性；语义判断的真实性仍由主 agent 负责，不能把全部填 pass 的模板当作产品正确性的证明。advance 先重新跑检查，失败不推进；没有任何“轮数已满自动达标”路径。

## 评审与交付事件

| 事件 | 必需字段与行为 |
|---|---|
| prepare-review | review/resolve 阶段；首轮 evidenceClaimIds 为空；复审只选与具体回应相关的 claim。返回封存 packetFile。 |
| interview-* | plan、ask、resolve、summary、confirm、draft-authorize、resume 约束真实回答与依赖顺序；事件及格式见 interview.md。 |
| review-result | result 包含请求版本、宿主回执与独立 report，见 [review.md](review.md)。首轮不能覆盖。 |
| review-failed | requestId/reason；失败消耗调用预算，可在剩余预算内另建请求。 |
| decision | review/resolve 阶段；decision：findingId（如 R1-F1）/action/reason；accepted 需当前 PRD quote；rebutted 需 claimIds；上一轮逐条回应后才可复审；deferred/user_decision 的 blocker 仍阻断。 |
| export | export 阶段；target 可省略，默认本地；若指定目标，见 [extensions.md](extensions.md)。 |
| publish-receipt | receipt 来自真实目标写入操作；检查既有 docId、baseVersion、operationId、附件与远端引用。 |
| draft-export | 当前来源对应的 PRD 可随时导出；草稿注明缺口，不推进、不覆盖正式 delivery。 |

每个事件均带 revision。PRD 行为改变时先更新 specification，再登记 draft；完成失效的 specification/visuals 闸门后再复审。只有回复/证据发生变化可以直接从 resolve 路由有限复审。

done 后也可再次 export，转回 export 完成交付检查，无需重复产品阶段。重新导出可从当前稿恢复被改动的交付包；相同内容和目标复用 operationId 和已有远端回执，图片字节变化产生不同 operationId。交付清单同步保存真实发布回执，不仅存在于 state 中。

## 恢复、并发与资料保管

state.json 是当前状态；history/ 保存每次写入前的快照，sources/artifacts/drafts/reviews 留存版本。写入有独占锁、revision 检查、临时文件与替换；不保证跨进程崩溃时所有副文件与 state 同时提交，未被 state 引用的残留文件可以保留后核查。图/交付包改动会被哈希检查发现。

来源改变回到 intake；阶段产物改变回到对应阶段；PRD 改变回到 specification；图改变回到 visuals。旧首轮评审保留但不能代替当前版本。日志不能代替当前有效闸门。

残留 write.lock 先确认对应进程已结束，再移除；不能看见锁就删除。状态 JSON 损坏会失败并保留文件，可由用户从最后有效 history 快照恢复。不要手工修改 state 绕过闸门。

run 包含用户文档摘录和访谈，不自动上传 GitHub；放在被忽略的 .prd-runs 中。交付包来源链接按读者权限与实际目标空间转换。不要把作者原始来源目录交给冷读评审。
