---
name: ssr-workflow-configure
description: 配置全局流程节点、顺序、并行组、SLA、提醒及关键节点要求，预览后发布同步进行中项目；项目实际进度用流程更新 skill。
---

# SSR · 流程模板配置与发布

在含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 为此前缀简称。读取全局 workflow 页签，不需要用户先选择项目。发布流程会预览受影响项目；普通 RE/CPQ 等主数据维护仍不读取项目。

```sh
cost-cli masterdata get --tab workflow --limit 10000
cost-cli workflow preview --input preview.json --expected-revision GLOBAL_R
cost-cli workflow publish --input publish.json --expected-revision GLOBAL_R
```

读取完整模板，跟随 nextOffset，跨页 revision 改变则重读。保留现有节点稳定 `code`，界面名称不决定业务语义。新增节点使用唯一内部 ID，不能把改名实现为删除旧 ID 再新增。按实际意图调整：

- `name/nameZh/owner`、数组顺序、`parallelGroup`；同一并行组必须连续。
- `slaDays`（1–365）、`slaCalendar`（business/calendar）、`slaHolidays`（YYYY-MM-DD）、`reminderEnabled`。
- `required` 关键节点、`requiredFields` 信息项、`autoSkip`；关键节点不能 autoSkip。
- 唯一 `roundStart` 新成本轮次起点，起点及同并行组都不能设置 requiresConfirmedCost；`requiresConfirmedCost` 成本确认门禁；唯一 `finishesWorkflow` 结束节点，必须关键、独立、位于最后。

默认 SLA 为 3 工作日，周一至周五新加坡时间 09:00–18:00，每日 9 小时；自然日为连续 24 小时。节假日从配置读取。模板不填写项目 startedAt/dueAt/completedAt/pausedAt、fieldValues、note 或实际进度。

## 发布契约

两步使用既有 OperationRequest 信封，`data.schemaVersion:"1.0.0"`：

- 预览：`operation:"workflow.preview"`、`steps:完整模板数组`、可选 `migrateActiveProjectIds:[明确要重算活跃节点SLA的项目ID]`。
- 发布：改为 `operation:"workflow.publish"`，保留同一 steps 和 migrateActiveProjectIds，另加 `projectRevisions:{项目ID:预览返回revision}`。所有未完成项目使用预览返回的 revision；全局 revision 仍通过 --expected-revision 传入。

预览返回 `revision/nextRevision/projects[]`，每项目含 revision/completed/changed/changes/blockers/retained/steps。先形成可检查的变更和影响结果，再按用户授权发布；有 blockers 先解决，不能绕过保护。已授权发布无需重复确认，未授权迁移活跃期限则保持默认。发布返回全局 `record` 及 `updatedProjects/retainedProjects`；任一全局或项目 CAS 冲突需重新预览，不盲重试。

发布原子同步全局模板和可更新的未完成项目，Today、Project 使用同一结果。活跃节点原 startedAt/dueAt 默认保留；只有明确列入 migrateActiveProjectIds 才按新 SLA 重算。已完成/已跳过节点保留历史定义与证据，完成轮次保留原样。不能删除有执行记录的节点或改变依赖后制造已完成假象；以预览 blockers/retained 为准。

无论原轮次是否完成，新建或复制成本 Draft 都采用最新全局模板，从 roundStart 启动新轮次；原成本和原轮次快照不变。成本版本、捕获费率及金额不随流程发布变化。旧 `masterdata update --tab workflow` 已接入同一安全发布路径，不是绕过预览和项目校验的捷径。需要更新实际进度时使用 [项目流程更新](../ssr-workflow-update/SKILL.md)，不写独立 Status 或旧 SSR 记录。
