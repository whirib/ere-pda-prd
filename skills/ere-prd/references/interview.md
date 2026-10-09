# 采访与决策依赖契约

顺序参考 [mattpocock/skills 的 grilling](https://github.com/mattpocock/skills/blob/6fd947921b935b7e1e69293a200400f0fdd5c15f/skills/productivity/grilling/SKILL.md)：把设计映射成依赖树，当前可问的选择组成一轮，收到回答后再展开依赖它的选择。grill-me 本身仅是调用 grilling 的入口。本项目改写这些原则为状态契约，不依赖运行时安装该供应商工具。

## 区分四件事

- 事实：原文、代码、页面或工具已查证的情况；由 agent 找依据，不把可自行查证的问题交给用户。
- 假设：仍需研究的证据、性能或行为判断；保留验证路径，不升级为事实。
- 建议：agent 对选择的推荐，需说明取舍；不是用户答复。
- 决策：由用户明确，或由有决策权的现有材料直接规定。系统不确定相关文档是否有权决定时，不能自行标为 `authority:"decision"`。

不是问完固定清单就算理解。六项核心信息各自关联节点，一个节点可覆盖多项，资料已明确的答案直接复用。用户给出三部分方向不代表已经确认各部分的交互方式。

## 来源

用户消息为 `source.kind:"interview", actor:"user"`；模型建议为 `actor:"agent"`，不得伪装成用户。文档用 `authority:"decision"` 表示实际已确认、有权决定的材料，普通页面、外部资料用 `authority:"reference"` 或不填。字段描述真实来源，不是给模型添加权限的开关。

来源依据格式为 `{sourceId,sourceHash,unitId,quote}`。脚本记录来源登记 revision；提问后的答案必须来自后续用户来源，不能复用初始 brief。不能为了满足检查而把旧消息复制成新回答；宿主应保留真实消息位置与 reader 回执。当前通用库检查结构、引用和顺序，不能认证一句话是否真由人类说过，也不能判断引用在语义上是否支持结论。

## 事件顺序

每次先读取 `status`，事件带当前 revision；全部通过现有 `apply` 提交。新增来源会返工 intake，需要将新来源纳入 coverage；账本与已收到回答保留。

1. `interview-plan`：`nodes[]` 含 `id,topic,kind,material,coreKeys,dependsOn,why`。kind 为 fact/decision；coreKeys 从 user/problem/goal/scope/flow/constraints 中选。重要未知需 material:true。`when:{decisionId,equals}` 可表达由前置选择激活的分支。循环、未知前置、静默删除/降级重要节点被拒绝。
2. `interview-resolve`：资料已明确的节点可先记录。包含 `decisionId,status,value,reason,evidence[]`。status 为 answered/unknown/deferred；后两者保留未知，不能解锁重要依赖。复用决策材料时 value 必须直接出现在引用中；要解释出新选择时应向用户询问。
3. `interview-ask`：`id,questions[]`。每个问题含 `decisionId,question,recommendation,rationale`。只能询问当前前置已解决的 decision。事件登记后实际呈现问题，等待回答；账本不能代替用户可见提问。一个轮次只回答部分时，其余仍待答；未答完不能预开下一轮。
4. 收到用户回答：先登记实际 source，再以 `interview-resolve` 引用对应原话。只解锁由这些答案决定的下一层；模糊回答应记录 unknown，以具体实例或有差异的选项继续，不能原样循环追问。
5. `interview-summary`：重要节点全部解决、没有待答轮次后，提交 `text`，将当前理解及仍待验证的事实展示给用户。返回 summaryHash。
6. `interview-confirm`：`summaryHash,mode:"response",evidence[]`，引用总结呈现后的实际用户确认。计划、前置选择或依据改变会使确认失效。
7. 当前 discovery 产物各 `core.*.decisionIds[]` 关联对应节点，provisional 还需 `uncertaintyType:"research"|"implementation"|"decision"` 及 validation。研究待验证不阻断已明确方向，但不能让未回答的重要决定通过。所有重要决定及理解确认完成后，才能 advance。

若现有完整材料已经直接决定了所有重要选择，用户明确要求按它执行，且未发生新采访轮次，`interview-confirm` 可使用 `mode:"provided-input"`，引用实际授权。这避免重复采访已有答案；普通初步 brief 不能以此跳过尚未讨论的关键行为。

solution 的 `choiceDecisionId` 指向 answered 的 decision，`choice` 与其已确认 value 一致。若 agent 在方案比较中提出了新路径，先把选择加入依赖树，采访和确认后再锁定方案，而不是用旧范围引用为新交互背书。

## 呈现方式

一轮采用编号问题：问题说明当前要决定什么、不同答案影响什么，提供有真实差别的选项及暂定推荐。不要求用户照推荐选；允许自由回答与“还没想好”。只问前置已经明确的问题。问题很多时按认知负担分组，不把下一层混进本轮，也不机械限制为固定题数。

例如，尚未确认“语音跟随态表达什么”时，先问入口用途和对话关系。录音何时结束、是否文本确认、怎样显示一轮状态依赖其答案，留到下一轮。对可从现网或代码查证的布局、字段与接口能力自行查证，并保持相应下游未决。

用“我的理解是……仍不确定……建议……因为……这项需要你决定”表达当前依据，不说“信息已足够”来省略采访。新的用户回答、已有明确材料和明确授权优先于模型推荐。

## 探索、恢复和版本

用户明确要求先看探索稿时，提交 `interview-draft-authorize`，包含 `reason,evidence[]`。之后可登记 exploratory:true 的 draft 和 draft-export，待答问题、重要缺口与原阶段不变。正文写清分支，不暗中选定一条；“最终产出 PRD”或用户未答不算探索授权。

用户明确改变工作方式、取消未答轮次时，可用 `interview-resume` 的 `roundId,evidence[]` 记录原话。取消轮次不解决其中的重要选择，需要重新计算可问分支；不能因超时自动取消。

旧 run 没有 interview 账本时 `check` 明确阻断，不把旧 pass 当作新约束已通过。读取现有资料，补 actor/authority 的实际依据，登记依赖树，再检查受影响阶段。保留旧版本及首轮报告，不能手工改 state 伪造推进或新建 run 绕开同一未决项。

语义真实性仍需主 agent 与用户共同负责。这些检查能阻断未答、错序、过期引用、建议代答和无授权探索等结构性绕过；不保证模型完整识别所有未知，也不能替代宿主认证用户消息或最终产品判断。
