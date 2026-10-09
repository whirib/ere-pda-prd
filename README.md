# ERE PRD

本仓库收录当前相关的三个 skill：

| Skill | 用途 | 安装内容 |
|---|---|---|
| [ere-prd](skills/ere-prd/SKILL.md) | 中文需求探索、PRD、工程闸门与独立评审 | 复制整个目录，保留脚本、参考文档、元数据和许可证 |
| [grilling](skills/grilling/SKILL.md) | 按决策依赖树分轮采访，等待回答及共同理解确认 | 复制整个目录，可直接读取或调用 |
| [grill-me](skills/grill-me/SKILL.md) | 上游的显式采访入口，转交 grilling | 与 grilling 一起安装；需要宿主支持上游所写的 Skill 调用工具 |

grill-me 与 grilling 来自固定上游提交，保留下载后的 SKILL.md 和现有 Codex 元数据，随目录附带 MIT 许可证与来源说明。没有原生 Skill 调用工具的环境直接使用 grilling；ere-prd 的采访契约可独立运行，不依赖该工具。

一个可裁剪的中文 PRD skill，带可恢复的工程流程。把用户文档和访谈共同作为依据，先判断信息是否足够，再写最小合理方案、行为与验收；按需要实际生成图表，由用户当前 agent 的新上下文独立冷读，最后输出可移植文档包。

核心只需 **Node.js 22+**，无第三方包、模型 API key 或 Claude Code 依赖。主 agent 做产品判断，harness 检查资料覆盖、原文引用、版本、阶段、预算、评审回执和交付。代码不能代替产品判断或证明需求正确。

## 使用

把 [skills/ere-prd](skills/ere-prd) 整个文件夹放到当前 agent 支持的 skill 目录，或让 agent 直接读取其中的 [SKILL.md](skills/ere-prd/SKILL.md)。请保留 scripts、references、agents 和许可证；只复制 SKILL.md 会丢失 harness。仓库不自动改动你的全局配置。

在支持 Codex skill 的环境中，默认允许自动调用：用户提到“写需求”“PRD”（大小写均可）或“整理思路”即触发，同义表达如“整理需求”“梳理想法”也适用。无需显式指定 skill，也无需先准备需求文档。只要求整理思路时先产出清晰思路与待决问题，按请求决定是否继续完整 PRD 流程。

也可以显式调用：

> 使用 $ere-prd。把我提供的文档与访谈共同考虑，先找影响方向的关键缺口，再形成简洁清楚的中文 PRD；需要图时实际生成并查看，用当前 agent 的新上下文独立评审。

主 agent 按 [操作与数据契约](skills/ere-prd/references/harness.md) 创建工作区内的任务目录，再依次提交产物、检查、推进。无需用户手工填写全部 JSON。

```text
node skills/ere-prd/scripts/prd.mjs help
node skills/ere-prd/scripts/prd.mjs init <run-dir> <config.json>
node skills/ere-prd/scripts/prd.mjs status <run-dir>
```

## 工作方式

| 阶段 | 达标后推进的依据 |
|---|---|
| 资料读取 | 文档/访谈纳入，相关页表图读到，事实有当前版本引用 |
| 需求探索 | 事实/决策依赖树完整，问题按前置分轮，实际回答与共同理解确认有原文依据 |
| 方案 | 最小价值闭环、真实替代路径、明确取舍；选定路径对应已确认决策 |
| PRD | 可观察行为、验收、权限和关键异常/恢复；必要的模型评测与执行契约 |
| 配图 | 图确实有帮助，实际生成、查看、文图一致；简单步骤可用列表 |
| 冷读 | 同 host/模型的新会话，先复述理解再给独立增删改/合理性意见 |
| 讨论 | 不共享作者完整记忆，按意见路由必要证据；最新阻断项解决，原承诺保留 |
| 交付 | Markdown、图片、可编辑图源、版本清单；远端写入需真实回执 |

资料/采访/PRD/图变化会使相关下游检查失效；每次写入检查 revision，保留快照与独立首轮报告。最多冷读加两次复审，失败也计调用；预算用尽不会自动通过。没有新信息的追问换成具体实例或差异选项，不能用延期记录解决重要选择。

“能写草稿”“需求已验证”“研发可以执行”分别判断。采访的重要问题未答时保持等待，不能先代拟整份 PRD。用户明确要求先看探索稿时可授权 `draft-export`，不推进原阶段；完成采访后，评审隔离不足仍可交付诚实标注的草稿。完整已确认材料可复用明确执行授权，不强制问题数量。详见 [采访契约](skills/ere-prd/references/interview.md)。

## 图与扩展

内置 render 工具实际输出 SVG 与可编辑 Mermaid/JSON，支持流程、状态、折线、柱状图。图形从结构化关系生成，Mermaid 是可编辑关系源；不依赖 Mermaid 引擎。时序图、泳道图、复杂图及 PNG 转换可以接入现有 renderer skill。

reader/output 根据实际能力开放匹配，不限制文档格式或公司。默认输出便携 Markdown；未来接入的内部空间 skill 负责转换、附件上传、幂等更新和读取核查。详见 [扩展接口](skills/ere-prd/references/extensions.md)。这里提供接入契约，尚未宣称已实现所有公司空间的连接器。

自调 DeepSeek harness 可接 [stdio 协议](skills/ere-prd/references/review.md)，或作为额外意见来源。如果它本来就是用户当前 host，可以执行默认评审；使用其他 host 时无需先安装它。

## 隔离的实际边界

新进程、临时目录或 `fork_turns="none"` 不足以证明自动记忆/共享工具已隔离。需要宿主实际关闭记忆、检索与背景注入，限制工具并提供真实回执。库验证回执与输入/版本契约，不能从模型自填 JSON 证明平台隔离。

无法核查时记录 partial 并交付草稿，不删除用户真实记忆。原生新会话路径和通用 stdio bridge 均可使用；具体 DeepSeek/Kimi/Qwen runtime 的实际能力需要接入后测试。

## 本地验证与示例

```text
node scripts/check-package.mjs
node --test tests/*.test.mjs
node examples/run-demo.mjs
```

demo 使用明确标注的虚构资料和 mock 评审，展示完整状态协议，不代表真实模型评审通过。可阅读 [中文 PRD 示例](examples/sample/PRD.md)，运行产物在 .demo-output 中。仓库 CI 对 Windows/Linux 与 Node 22/24 运行包检查、行为测试和 demo。

测试涵盖文档漏读/假引用、方向缺口、重复采访、条件契约、旧版本失效、冷读输入泄漏、记忆未知、阻断未决、预算、承诺侵蚀、实际渲染、文件改动、并发及远端附件等。真实试用与局限见 [验证记录](VALIDATION.md)。

## 来源与裁剪

参考 Product Idea Excavator、PM-Skills、prd-debate 及 grill-me / grilling。保留证据探索、依赖分轮采访、PRD 验收和讨论路由，删除固定供应商、固定章节/评分、强制找问题及达到轮数自动推进，补上工程状态与隔离边界。

逐仓库阅读范围、固定提交与裁剪理由见 [来源审计](SOURCE_AUDIT.md) 和 [机器清单](source-manifest.json)。许可证与变更声明见 [第三方说明](THIRD_PARTY_NOTICES.md)。项目采用 Apache-2.0；上游版权和许可证保留在可独立复制的 skill 文件夹中。
