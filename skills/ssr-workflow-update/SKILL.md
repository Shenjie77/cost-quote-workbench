---
name: ssr-workflow-update
description: 更新项目可配置流程的节点信息、完成确认、并行待办和暂停恢复，归档节点文档，查询 SLA 跟进提醒；历史评审只读，全局模板用流程配置 skill。
---

# SSR · 项目流程更新

在含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 为此前缀简称。已知项目号直接窄读目标，未知才 `project list`。不读完整 workspace，不要求再填 SSR 审批单或独立 Status。

## 查询与动作

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

## 节点文档

上传前核对实际节点 code 和目标流程轮次；当前轮次使用 `workflow-plan` 回执的 `workflowVersion`，不能用正在查看的成本版代替。显式传 `--node-code CODE --version Vn`，历史轮次按用户指定的版本归档。

节点文件存入 `workflow/<可读节点名称>`，不按轮次再建目录。`nodeCode/versionCode` 仍保留在元数据中；名称用于展示和归档目录，不能用名称代替 CLI 节点代码或从路径推断轮次。页面操作为选择节点后拖入文件，也可点击选择文件。

```sh
cost-cli files list --project-id ID --node-code CODE --version Vn
cost-cli files upload --project-id ID --node-code CODE --version Vn --input /absolute/document.xlsx --compact
cost-cli files download --project-id ID --file-id FILE_ID --output /absolute/download/document.xlsx
```

文档上传独立归档，不改变项目 revision，不完成节点、不解锁成本，也不代表审批通过；完成确认仍走上面的节点动作。核对上传返回的 file.id、nodeCode、versionCode 和 sha256。通用项目文档和归档位置由项目管理 skill 处理；文件限制、重试及返回结构按需查 [CLI 文档归档](../../docs/cli-control-manual.md#project-documents-and-archive-location)。

## 业务边界

- 前置关键节点未完成时，后续节点无法开始或完成。并行组内关键节点均需确认。后续节点完成后，符合配置的未办非关键节点记为 **Skipped** 并保留触发依据，不伪造 Completed 或公司审批。
- `requiresConfirmedCost` 节点要求当前 `workflowVersion` 的成本为 Confirmed。先窄读该版成本 settings/summary 核验；未有定稿授权时展示本版成本后取得用户确认，再交成本更新 skill 定稿。“开始节点”不是成本定稿授权。锁定本版不代表公司审批通过。
- `finishesWorkflow` 节点实际完成后停止本轮全部提醒；不能按名字或固定 `QUOTE_COMPLETED` 编码推断。导出 Excel 不自动完成节点。完成轮次不能直接重写；需求变化时新建成本 Draft，无论旧轮次是否完成都采用最新全局流程模板，从其 `roundStart`（默认 DTRB）开始，原成本/轮次快照保留。查看旧成本不改变工作轮次。

## SLA 与提醒

按新加坡时间计算。默认工作日历为周一至周五 09:00–18:00，1 SLA 天为 9 工作小时，排除配置的节假日；自然日模式为连续 24 小时。未开始节点不计时；整轮无活跃或暂停节点时，仅首个待开始阶段中开启提醒的节点显示普通“待启动/待登记”，不标逾期、不展示后续阶段。关闭首阶段提醒不改为提示后续阶段，等待成本确认也不能隐藏待启动任务。已开始节点在 SLA 内普通提醒，最后一日马上处理，超过精确 dueAt 为紧急。可设更早 followUpDate。暂停期间停止一般提醒，到恢复安排日期提示恢复；关闭节点提醒不解除关键节点或成本门禁。

```sh
cost-cli digest generate --as-of YYYY-MM-DD
cost-cli reminders scan --as-of YYYY-MM-DD
cost-cli reminders list
cost-cli reminders ack --id ID --fingerprint RETURNED_FINGERPRINT
```

以上是全局入口，无 project-id；按结果筛选。每个活跃节点可有一条提醒，Today 按项目汇总最高紧急程度。ack 仅标已阅；状态更新使提醒退出。API 运行时扫描，skill 不会后台常驻，也不代表已联系 PM；未授权不发消息。

[历史流程与评审](references/reviews.md) 只在核对既有依据时读取。Proposal/Scope/公司链接用 `project get/update --section metadata`。全局节点和发布同步用 [流程配置](../ssr-workflow-configure/SKILL.md)。
