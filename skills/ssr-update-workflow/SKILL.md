---
name: ssr-update-workflow
description: 登记项目流程节点进展、负责人、完成确认或暂停恢复；仅查进度不使用。
---

# SSR · 更新流程节点

在含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 为此前缀简称。已知项目号直接窄读目标，未知才 `project list`。不读完整 workspace，不要求再填 SSR 审批单或独立 Status。

## 节点写入

```sh
cost-cli project get --project-id ID --section workflow-plan
cost-cli project workflow-action --project-id ID --input action.json --expected-revision R
```

`workflow-plan` 返回 `steps/phases/blockers/completed/templateRevision`。根据实际返回的节点 `code` 和状态选择动作；名称可自定义，不能由“DRB”等名称猜 code。同一并行组可同时有多个活跃节点，不能只处理 `currentWorkflowStepCode`。

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "workflow-action-unique-id",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "project.workflow-action",
    "action": {
      "nodeCode": "ACTUAL-RETURNED-NODE-CODE",
      "action": "update",
      "owner": "实际负责人",
      "followUpDate": "2026-09-15",
      "note": "按用户提供的公司系统进展登记。"
    }
  }
}
```

日期和说明换成真实内容；未传字段保持原值。动作包括 `start/complete/skip/update/pause/resume/reopen`。`fields` 只使用节点 `requiredFields` 中的字段名。关键节点完成需填完必填信息，并在用户确实确认信息后发送 `confirmed:true`；已有明确授权无需重复询问。`skip/pause/reopen` 必须给 `reason`，关键节点不能跳过。开始时间修正或手工改 `dueAt` 需原因；正常改 note 不重置 SLA。

旧节点没有 startedAt 时，迁移以升级时刻初始化需要开始计时节点的 SLA，不推测过去的实际开始日；保留原 followUpDate。用户给出实际开始时间后可通过节点动作修正，并填写原因。旧完成标记不代表公司批准，不补造审批证据。

带项目最新 revision 写入；成功核对 `OperationResult` 的 projectId/revision/workflowVersion/nodeCode/action。CAS 冲突后重读目标计划并重施原意，不盲重放旧动作。

## 业务边界

- 前置关键节点未完成时，后续节点无法开始或完成。并行组内关键节点均需确认。后续节点完成后，符合配置的未办非关键节点记为 **Skipped** 并保留触发依据，不伪造 Completed 或公司审批。
- `requiresConfirmedCost` 节点要求当前 `workflowVersion` 的成本为 Confirmed。先窄读该版成本 settings/summary 核验；未有定稿授权时展示本版成本后取得用户确认，再交成本更新 skill 定稿。“开始节点”不是成本定稿授权。锁定本版不代表公司审批通过。
- `finishesWorkflow` 节点实际完成后停止本轮全部提醒；不能按名字或固定 `QUOTE_COMPLETED` 编码推断。导出 Excel 不自动完成节点。完成轮次不能直接重写；需求变化时新建成本 Draft，无论旧轮次是否完成都采用最新全局流程模板，从其 `roundStart`（默认 DTRB）开始，原成本/轮次快照保留。查看旧成本不改变工作轮次。

[历史流程与评审](references/reviews.md) 只在核对既有依据时读取。Proposal/Scope/公司链接用 `project get/update --section metadata`。全局节点和发布同步用 [流程配置](../ssr-configure-workflow/SKILL.md)。

用户要求扫描或标记提醒已阅时才读 [提醒动作](references/reminders.md)。只查进度使用 `$ssr-query-workflow`；归档节点附件使用 `$ssr-manage-files`，节点更新不预先加载这些技能。
