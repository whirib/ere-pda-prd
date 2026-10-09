# 来源与许可证

本目录的 SKILL.md 来自 [mattpocock/skills](https://github.com/mattpocock/skills/blob/6fd947921b935b7e1e69293a200400f0fdd5c15f/skills/productivity/grill-me/SKILL.md)，固定提交为 `6fd947921b935b7e1e69293a200400f0fdd5c15f`，下载后的原文未经改写。

版权与 MIT 许可见随目录附带的 [LICENSE](LICENSE)。agents/openai.yaml 保留本地已有的 Codex 元数据；本说明为仓库新增文件。

这是调用 grilling 的显式入口，应与 grilling 一起安装。它要求宿主提供上游所写的 Skill 调用工具；没有该工具时直接读取或调用 grilling，不声称调用过不存在的工具。
