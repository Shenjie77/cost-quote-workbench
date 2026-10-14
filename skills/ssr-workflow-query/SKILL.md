---
name: ssr-workflow-query
description: 只读查询 SSR 项目流程进度、阻塞、SLA 及今日待办；不推进节点或标记已阅。
---

# SSR · 查询流程与待办

在仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`，下文简称 `cost-cli`。项目 ID 已知时直接：

```sh
cost-cli project get --project-id ID --section workflow-plan
```

名称未知 ID 时仅先 `project list` 匹配；多匹配需选定。读取返回的 steps/phases/blockers/completed/workflowVersion，按真实节点 code 汇报当前并行节点、负责人、期限与阻塞，不由“DRB”等显示名推断状态。只问历史时追加 `project get --project-id ID --section workflow-history` 并按需分页。

问“今天哪些项目需要跟进”时直接 `cost-cli digest generate`；需要指定日期时加 `--as-of YYYY-MM-DD`。这是全局查询，不接受 project-id，不先逐项目读取。仅查看已经保存的提醒记录时用 `cost-cli reminders list`；普通查询不运行 scan/ack 或更新节点。

日期默认新加坡时区。使用平台返回的紧急程度和截止时间，不自行重建 SLA。无节点活动不代表已完成，确认 completed；成本 Confirmed 不表示公司批准。

不预读其他技能、整个 workspace 或全量 schema。查询完成即返回结果；用户另要求推进节点才使用 `$ssr-workflow-update`。
