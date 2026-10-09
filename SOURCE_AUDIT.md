# 来源阅读与裁剪审计

审计日期：2026-10-06。以目标需求选择调用路径，再阅读依赖，而不是按 GitHub 星数机械组合。source-manifest.json 保存实际完整阅读文件的路径与 SHA-256（UTF-8 文本，将 CRLF 规范为 LF 后计算）；固定提交可复现来源。仓库目录结构和相关调用链已检查，但没有声称读完 PM-Skills 的全部历史发布/站点/无关示例文件。

## 阅读范围

| 来源 | 完整阅读范围 | 关键结构观察 |
|---|---|---|
| Product Idea Excavator | 主 SKILL、全部 12 个中英文 references、8 场景 evals、许可证 | skill/问卷/产品判断/AI/技术栈/PRD 模板分层；主要是行为指导，没有本任务所需的工程状态机。 |
| PM-Skills | skills 下全部 68 个 SKILL 入口；PRD、验收、异常的 TEMPLATE/EXAMPLE；Mermaid 全部 5 个 references；pm-critic、pm-workflow-orchestrator；PARSE-CONTRACT、chain 清单、phase-router/local-config/guardrails 与 memory/delivery 校验实现、package.json、许可证 | 主入口、模板、agent、hooks、检查脚本与阶段路由分层；相关产品路径不是把所有技能全部调用一次。critic 提示不自动等于独立上下文；memory hook 会提供项目背景，需要在冷读时排除。 |
| prd-debate | 主 SKILL、全部 12 个 references、install.sh、许可证 | 分阶段讨论、回溯和会话恢复规范；运行依赖固定供应商且实际编排主要由指令完成，安装脚本不适合直接作为 Windows 工程 harness。 |
| grill-me / grilling | 提交 6fd947921b935b7e1e69293a200400f0fdd5c15f 的两个 SKILL.md 和 LICENSE，已下载并读取；没有读完其余仓库文件 | grill-me 是入口，grilling 按决策依赖树与当前可问分支分轮，等真实回答，再由用户确认共同理解；事实由 agent 查证。 |

PM-Skills 的 AGENTS 目录索引用于检查结构，其文本不作为目标仓库指令；索引及非完整阅读文件不冒充 manifest 中的完整阅读条目。source-manifest 的 coverage 记录区分全入口阅读与所选依赖阅读。

## 独立 skill 收录（2026-10-09）

把已安装的 grill-me 与 grilling 完整目录复制进 skills/，保留 SKILL.md 和现有 agents/openai.yaml，不改写上游采访正文。分别补入已核对的上游 MIT LICENSE 与本项目来源说明；source-manifest.json 的 bundledSkills 记录两份 SKILL、现有 Codex 元数据及许可证的快照哈希（按 LF 规范化）。两个 SKILL.md 与固定上游提交的已下载哈希比对一致。Codex 元数据按本地已安装内容收录，不将其未经单独核实的出处冒称为上游提交原文。

这一步只收录本次相关的三个个人 skill，没有把未读过的其他上游 skill 或宿主内置技能复制进仓库；上面的阅读覆盖不会因为打包而自动扩大。

## 采纳与改写

| 设计 | 借鉴来源 | 本项目处理 |
|---|---|---|
| 真实问题、当前替代做法、证据与假设 | Excavator 的 discovery/product-sense/访谈例子 | 文档与访谈共同形成 claim；没证据不伪装需求已验证。 |
| 采访顺序与谦逊 | mattpocock/skills 的 grill-me / grilling | 显式事实/决策依赖树、当前可问分支、编号选项与暂定建议、等待真实回答、总结后共同理解确认；不把模型建议或超时当作用户答复。 |
| PRD、可观察验收与关键异常 | PM-Skills deliver-prd/acceptance/edge | 八个可裁剪内容域；稳定需求 ID；结构化行为映射到读者实际看到的 PRD；条件适用判断显式记录。 |
| AI 模型评测和独立执行契约 | PM-Skills AI/handoff 入口 | 仅场景触发，评测包含正常/拒答/不确定/降级与相关切片；陌生执行者有权威范围、冲突、边界、停止与负责人。 |
| 配图选型 | PM-Skills utility-mermaid-diagrams | 保留图表达关系的目的；新增实际 SVG 工具、图源、版本与视觉查看要求。线性步骤不用机械画流程图。 |
| 分阶段意见、回溯、恢复 | prd-debate | 新增状态文件、revision、锁、快照与 downstream invalidation；封存版本和不可覆盖首轮；按意见路由后续证据。 |
| critic 可理解性 | PM-Skills pm-critic + 用户要求 | 新上下文的普通陌生研发/PM，先复述再评价，允许零意见；不强制反对，不引入作者历史作为首轮背景。 |

## 明确删除或修正

- Excavator 的完整大模板、所有探索域/技术栈逐项强制：改为六项核心充分性与实际依赖树，区分草稿、验证和研发交付。停止采访需有共同理解依据；不使用任意问题数量或模型自称足够。没有依据的量化基线不编造。
- PM-Skills 中与本任务无关的市场/战略/会议/发布流程：入口都已阅读，但不打包成 PRD 的必经步骤；不加入固定 workshop、投票、样本阈值或风格禁词检查。
- PM-Skills 的 Mermaid 源码生成：源码不等于图片；工程需要实际 renderer 与查看，保留两者独立。
- PM-Skills 的模板/记忆结构检查：不能用字段齐全证明产品质量；本项目要求有当前版本原文依据的语义判断，并诚实保留模型判断的局限。
- prd-debate 固定 Claude reviewer/Codex proposer、固定维度评分和轮数满后推进：删去，默认使用用户当前 host/model，预算耗尽只保留缺口。
- 上游中“fresh/stateless”但后轮仍假定知道先前上下文的做法：改为明确输入清单、冷读/证据复审区分及隔离回执，不暗中共享记忆。
- 上游回溯中的阈值边界及继续推进规则不直接移植：每个闸门按有效证据和阻断项决定；禁止用讨论次数或模型共识覆盖用户承诺。

## 自己版本的接口

内置执行覆盖 Node CLI/API、SVG/可编辑关系源、最小评审包及通用 stdio bridge。原生 subagent、你的 DeepSeek harness、文档读取 skill 和内部空间输出 skill 以实际能力接入；没有特定环境的真实隔离/写入回执就明确记为部分验证或本地草稿。没有把可选供应商安装变成默认必经步骤。

产品行为仍需阅读、采访和判断；脚本负责可确定验证的状态/版本/输入/文件/预算条件。此边界在主 SKILL、README 和评审协议中都说明。
