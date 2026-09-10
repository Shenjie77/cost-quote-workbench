# 可配置 Project Workflow

工作台只维护一套项目流程。用户查看公司平台后，登记相应节点的信息、负责人和实际进度。Today、Project 与 Agent 读取同一份计划和执行记录，不再要求填独立 Project Status、SSR 审批单或 reviewGate。

## 节点与并行阶段

Master Data → Workflow 配置节点名称、顺序、并行组、默认负责人、SLA 和提醒。系统仍有稳定内部 `code` 用于保存和 CLI 引用；界面名称可以修改，业务行为由属性决定，不按名字识别。

| 属性                                      | 作用                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `parallelGroup`                           | 连续的同组节点组成一个并行阶段，组内分别跟进                        |
| `required` / `requiredFields`             | 关键节点及完成前必须登记的信息                                      |
| `autoSkip`                                | 后续节点完成时，可将符合条件的未办非关键节点标为 Skipped            |
| `slaDays` / `slaCalendar` / `slaHolidays` | 处理期限、工作日或自然日日历及排除日期                              |
| `reminderEnabled`                         | 是否提示该节点，不影响关键节点和成本门禁                            |
| `roundStart`                              | 唯一的新成本轮次起点，默认 DTRB；起点及同并行组均不能要求成本已定稿 |
| `requiresConfirmedCost`                   | 开始/推进该节点前必须确认本轮成本                                   |
| `finishesWorkflow`                        | 唯一结束节点，必须关键、独立且位于最后；完成后停止全项目提醒        |

默认模板涵盖 Proposal/Scope、DTRB、成本编制、DRB、概算、专业评审、投标评审、报价决策和报价完成；它是可配置起点。概算与专业评审等需要并行时，配置为同一并行组，不必将多个待办挤在一个当前节点备注里。

节点数量可以超过 10 个。编辑器显示实际 Steps / Phases 数量，顶部和列表底部均可使用 **Add Step** 继续添加；新增节点进入草稿，预览并发布后同步到适用项目。

`workflowVersion` 是正在处理的成本轮次，`activeVersion` 是正在查看的成本版本。查看旧版不会移动当前流程。无论原轮次是否完成，新建或复制成本 Draft 都采用最新全局流程模板，从其 roundStart 开启新轮次；原成本和原轮次快照保持不变。起点及同并行组不能设置 requiresConfirmedCost，避免新 Draft 无法开始。

## 开始、确认、跳过和暂停

- 待开始节点为 `not_started`，尚不计 SLA。开始一个并行阶段会启动组内待开始节点，各自记录 startedAt/dueAt。
- 前置关键节点未完成时，后续节点不能开始或完成。关键节点完成需要必填信息齐全，并明确确认信息；设置提醒关闭不能绕过此要求。
- `requiresConfirmedCost` 节点仍要求本轮成本经用户确认成为 Confirmed。定稿只锁本版成本，不等于公司 DRB 通过；用户需求变化时可以建立新 Draft。
- 非关键节点可按规则跳过，必须记录原因。后续完成引发的自动跳过记录为 **Skipped** 和触发依据，不是 Completed，不生成审批证据。
- 暂停需要原因，保留计时信息。暂停期间不发一般提醒；可用 followUpDate 安排恢复检查，到期提示恢复。恢复按剩余 SLA 继续，不能靠反复改备注重置期限。
- 已完成/已跳过节点只能通过 reopen 恢复执行；后续关键节点已完成时，前置节点不可重开，应建立新成本轮次。结束节点已完成的整轮保持历史，不直接重写。

公司实际申请、审批和客户发送仍在公司平台处理，本地记录不会代为申请或推断批准。报价 Excel 导出也不自动完成结束节点。

## 节点文档

选择节点后，将文件拖入其 **Documents** 卡片即可上传，也可点击卡片选择多个文件。磁盘路径为 `workflow/节点名称`，文件记录保留流程轮次。节点已完成、项目挂起或成本已锁定时仍可补充附件；上传不改变流程进度或成本。**Project Files & Archive** 汇总所有文件，包括旧轮次与退役节点，并提供项目公共文件上传和归档根目录设置。项目目录只包含 `workflow`、`cost`、`quotation`；详见 [项目文件归档](project-files.md)。

## 整个项目挂起

在 **Project Workflow** 项目信息栏打开 **Project On Hold** 开关，即可挂起整个项目。Project List 显示 **On Hold** 标记。挂起期间，Today、Agent Digest 和提醒收件箱均不再把该项目列为待跟进，也不会产生节点恢复检查提醒。

挂起保留当前节点及并行进度，节点仍可浏览；恢复开关后再更新流程。成本版本仍按各自 Draft / Confirmed 规则管理，挂起本身不锁成本。新建成本轮次会保留项目挂起状态。恢复时按暂停期间补偿活跃节点的 SLA；原本单独暂停的节点仍保留其节点暂停状态。

项目挂起记录在同一 Project Workflow 中，不需要另外维护 Project Status。节点的 **Pause / Resume** 仍适用于某一项任务暂停并安排恢复检查，两种操作可以分别使用。

## SLA 与提醒

默认 SLA 为 3 工作日，新加坡时间周一至周五 09:00–18:00，每 SLA 天为 9 个工作小时，排除配置的节假日。选择自然日时，每天是连续 24 小时。开始时间和截止时间持久化保存；一般修改负责人、备注或信息不会重置计时，修正开始/截止时间需要原因。

| 情况                                 | 提醒                                    |
| ------------------------------------ | --------------------------------------- |
| 已开始，仍在 SLA 内                  | 普通跟进                                |
| 新加坡当地已到截止日、尚未超过 dueAt | 马上处理                                |
| 当前时间超过精确 dueAt               | 紧急处理                                |
| 提前安排的 followUpDate 已到         | 提醒跟进，不把尚未到期的 SLA 说成逾期   |
| 无活跃/暂停节点时，首个待开始阶段    | 普通“待启动/待登记”，不计 SLA、不标逾期 |
| 后续待开始、已完成、已跳过、关闭提醒 | 不提醒                                  |
| 暂停                                 | 等到恢复安排日期再提示恢复              |
| 配置的结束节点已完成                 | 停止本轮全部提醒，包括旧评审残留        |

待启动提醒只覆盖首个待开始阶段中开启提醒的节点；不会越过关闭提醒的阶段展示未来节点。等待成本确认的节点仍需要跟进，不因门禁阻塞而隐藏。开始后再按实际 SLA 判断紧急程度。

一个项目可有多个节点提醒。Today 按项目去重，按最高紧急程度排序，可展开各节点；点击节点打开同一项目流程。收件箱已阅状态在不相关刷新和重启后保留，关键来源变化或紧急程度升级会重新提示。`ack` 只是已阅，完成应登记节点动作。

API 服务运行时自动扫描。`digest generate --as-of YYYY-MM-DD` 的历史日查询使用新加坡当日中午；运行中扫描使用实际时间。关闭服务后 skill 不会自行后台常驻，也不会未经授权给他人发送消息。

## CLI 窄入口

以下 `cost-cli` 指仓库根目录的 `npm run --silent cost-cli --`：

```sh
cost-cli project get --project-id ID --section workflow-plan
cost-cli project workflow-action --project-id ID --input action.json --expected-revision PROJECT_R
cost-cli project get --project-id ID --section workflow-history --limit 20
```

计划返回 `steps/phases/blockers/completed/templateRevision`。动作文件使用既有 OperationRequest 信封，实际节点 ID 从计划返回值选择：

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "workflow-action-1",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "project.workflow-action",
    "action": {
      "nodeCode": "ACTUAL-RETURNED-NODE-CODE",
      "action": "update",
      "owner": "实际负责人",
      "note": "实际公司平台进展"
    }
  }
}
```

动作可用 start/complete/skip/update/pause/resume/reopen；可选 followUpDate、startedAt、dueAt、fields、confirmed、reason。fields 的键只能来自该节点 requiredFields。操作返回窄收据，使用项目 revision 做 CAS；不直接修改 state、workflowVersion 或 versionWorkflows。

整个项目挂起和恢复也使用 `project workflow-action`，将信封中的 action 分别设置为 `{"action":"hold_project"}` 和 `{"action":"resume_project"}`。这两种项目动作不传 nodeCode，可附加 reason；`workflow-plan` 返回 `workflowHold`，有值表示项目已挂起。

## 全局发布和同步

```sh
cost-cli masterdata get --tab workflow --limit 10000
cost-cli workflow preview --input preview.json --expected-revision GLOBAL_R
cost-cli workflow publish --input publish.json --expected-revision GLOBAL_R
```

预览与发布文件使用 OperationRequest。`data.operation` 分别为 workflow.preview/workflow.publish，`steps` 是完整定义数组；可选 `migrateActiveProjectIds` 明确列出要按新 SLA 重算活跃期限的项目。发布额外携带 `projectRevisions` 映射，采用预览返回的未完成项目 revision。

预览列出每项目 changes/blockers/retained/steps。发布同时校验全局和项目版本，原子更新全局配置及允许同步的未完成项目，Today/Project 随同刷新。任一冲突先重新预览；有阻塞项时不绕过依赖或历史保护。

活跃节点默认保留原 startedAt/dueAt；只有明确指定 migrateActiveProjectIds 才重算。已完成/已跳过节点的原定义与执行记录保留，完成轮次保持原样。流程发布不更改成本版本、捕获的 RE 费率或金额。

全局 RE、分包、维保、CPQ 等维护仍只读写目标页签，不读取项目。只有流程配置发布需要评估并同步受影响项目。旧 masterdata update --tab workflow 也经过同一保护路径，不是只改全局而遗漏项目的旁路。

## 历史与兼容

`workflowEngineVersion:1` 标记新执行模型，`workflowTemplateRevision` 记录采用的模板版本。执行和同步动作写入 workflowUpdates，历史可分页查询。旧 SSR submissions/results/closures/followUps、投标答复和 reviewGates 保留只读；projectStatus/currentWorkflowStepCode 是兼容投影，不再是另一套可直接维护的流程。

旧节点没有 startedAt 时，以升级时刻初始化需要开始计时节点的 SLA，不假设过去的实际开始日。已有 followUpDate 保留；用户可在节点中按实际开始时间修正，并记录修正原因。迁移沿用完成标记和原始历史，不据此推断公司已批准，也不补造审批证据。

参见 [项目流程 Skill](../skills/ssr-workflow-update/SKILL.md)、[流程配置 Skill](../skills/ssr-workflow-configure/SKILL.md) 和 [全局主数据](global-master-data.md)。
