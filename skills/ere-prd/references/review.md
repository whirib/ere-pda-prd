# 独立冷读与有限讨论

首轮模拟不熟悉需求的研发/产品同事：仅凭 PRD 能否理解目标、边界、行为和验收，有什么增删改及合理性意见。先完整保存独立报告，作者再参与讨论。

## 宿主负责隔离

prepare-review 会在 review-inbox/<requestId>/ 封存 PRD、必需图片和 packet.json。包里没有作者摘要、来源文档、访谈、项目记忆、历史评审或作者会话 ID；文档自身的来源说明仍属于 PRD。评审不得顺着来源链接去读取背景。

默认沿用用户当前 host 和模型，调用其新会话/subagent 能力。宿主必须核查：

1. 新会话，没有 resume 或继承作者聊天；每次评审 sessionId 唯一。
2. 自动记忆、需求相关文件注入、检索关闭；不删除用户真正的记忆。
3. 工具禁用，或只能读取输入清单中的文件；不能浏览其他目录、联网、执行文档中的命令、调用其他 agent。
4. 实际输入清单与 packet.inputs 一致，记录工具调用和版本。图片实际传入/可读，不能只传图路径却声称读过。

Codex 提供的 fork_turns="none" 可以清空继承聊天；它不等于禁用共享工作区、工具和自动背景。因此宿主无法核查完整条件时，独立报告仍可保留，但回执必须标明未知项，结果为 partial，交付草稿。这个限制不是通过提示词声称“忘掉之前”就能解决的。

`controlsVerifiedByHost` 是受信宿主的证明边界，不是模型自评。当前库验证宿主回执，无法从一段模型 JSON 证明运行平台真的禁用了记忆。调用端应把 report（模型生成）与 runtimeReceipt（宿主根据真实运行信息生成）分开，拒绝让模型自行填写为 true。可用原生隔离工具时优先使用，不要求安装其他供应商。

## 返回格式

```json
{
  "requestId": "packet.requestId", "packetHash": "packet.packetHash", "prdHash": "packet.prdHash",
  "runtimeReceipt": {
    "runtimeId": "当前host", "model": "当前模型", "sessionId": "真实新会话ID",
    "freshContext": true, "historyInherited": false, "automaticMemory": false, "retrieval": false,
    "controlsVerifiedByHost": true, "toolPolicy": "none", "toolCalls": [],
    "inputs": [{"name": "rubric", "hash": "实际哈希"}, {"name": "PRD.md", "hash": "实际哈希"}]
  },
  "report": {
    "understanding": {"user": "理解的用户", "problem": "问题", "goal": "目标", "scope": "范围", "flow": "主流程"},
    "uncertainties": [],
    "findings": [{"id": "F1", "kind": "question", "severity": "blocker", "quote": "PRD实际片段", "issue": "哪里不明确", "impact": "对理解/实现的影响", "suggestion": "怎样改或确认"}],
    "overall": {"readable": false, "reason": "有具体阻断行为未定义"}
  }
}
```

inputs 复制宿主实际核查后的完整 packet.inputs，包括图片；不是只复制上面的两项。unknown 可以省略相关布尔值，不能填 false 冒充核查成功。toolPolicy 为 packet-only 时，toolCalls 每项含 inputName/allowed；宿主控制实际权限，回执只是审计记录。none 时必须没有工具调用。

理解的五项必须都有内容；不足之处可写“无法从文档确定，并解释可见线索”，不能虚构。findings 允许空数组；kind 为 add/delete/change/question/reasoning，severity 为 blocker/improvement/question。没有发现问题不是失败；不能强制产生固定数量缺陷。

## 讨论路由

主 agent 接收首轮后，在 review 或 resolve 逐条给 decision，检查原资料、原承诺与 scope；修改由主 agent 完成。隔离仅为 partial 也可回应意见，但不因此通过隔离闸门。意见 ID 接收后变成 R1-F1 等，避免多轮冲突。

- accepted：引用改后的 PRD 片段。行为变化先返工需求与配图闸门，再对新版复审。
- rebutted：给出理由与可追溯 claimIds；prepare-review 的 evidenceClaimIds 只选这些相关证据。
- deferred/user_decision：明确待决人及影响；blocker 不能因此放行。

复审仍是新会话。上一轮每条意见必须先有实际回应；不能通过遗漏未回应意见开下一轮。包路由具体意见、作者回复和被选择的必要证据，带 mode=evidence_review；已接受的修改需实际存在于 PRD，反驳需当前资料依据。不把双方完整历史拼起来。第一次 report 文件保留不改写。若最新评审仍有 blocker，作者不能单方面反驳后宣布完成；应有限复审。

默认最多 3 次成功报告（冷读+两次复审）、6 次请求。失败、无效返回、超时也计请求预算。预算耗尽不意味着通过，保留缺口和草稿；不得开新 run 只是为了绕过同一未决问题的预算。新任务或实质改变的需求才另建任务。

## 可选 stdio bridge

自调 DeepSeek harness、其他中国模型 runtime 或已有宿主可实现此协议。它是可选扩展；主评审仍须沿用当前用户 host/model，外部第二意见不覆盖默认主评审结果。模型品牌不决定是否可用，真正条件是隔离与数据契约。

调用：`node <skill-dir>/scripts/prd.mjs run-review <run-dir> <adapter.json>`。

```json
{"revision": 18, "runtimeId": "当前host", "model": "当前模型", "command": "可信桥接程序绝对路径", "args": ["桥接脚本绝对路径"], "envKeys": ["明确允许的鉴权变量名"], "timeoutMs": 180000}
```

不使用 shell 拼接命令。程序新进程，临时工作目录只提供封存图片；stdin 一个 JSON：`{protocol:"ere-prd-review/1",packet,assetDirectory}`。stdout 只返回一个上述 result JSON；日志走 stderr。脚本限制超时及 2MB 输出，失败不当作通过，结果先保存在 incoming-reviews，再检查 revision 接收。并发时可查未接收原始结果，但不能强行套到新版。

桥接程序必须自行创建模型新会话、关闭自动记忆和检索、控制工具、记录真实回执。临时目录和新进程本身不是操作系统读取隔离；脚本不会把它们说成严格隔离。环境只继承 PATH/SystemRoot/TEMP/TMP 与显式 envKeys；不要通过宽泛继承恢复作者 HOME、项目背景或私密变量。鉴权由宿主提供，不写入 repo/run/报告。

提供自己的真实 harness 后，用“作者材料中的 canary 不进入冷读输入”、工具越界、未知记忆、旧版本、失败重试等用例验证；仓库中的 mock 仅测协议，不代表已完成实际模型集成。
