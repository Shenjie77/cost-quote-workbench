---
name: ssr-workflow-update
description: 更新项目当前流程节点、节点进度，登记 DTRB/DRB/概算/专业/投标/报价评审证据及跟进日期；流程结构维护使用 ssr-workflow-configure。
---

# SSR · 流程与评审更新

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

项目号已知先 `project get --project-id ID`，按需读取 `masterdata get --tab workflow --id CODE`、`ssr get --section settings` 或 `ssr get --section submissions --id SUBMISSION-ID`，都带同项目号。

当前节点、节点 state、SSR 评审证据是三个独立记录，专用命令不会自动同步前两者。根据用户实际叙述只更新应变的字段；“到 DRB”不等于“DRB 已通过”：
- 当前节点：`project update`，changes 为 `{"set":{"currentWorkflowStepCode":"ACTUAL-CODE"}}`。
- 节点进度：`masterdata update --tab workflow`，changes 为 `{"upsert":[{"code":"ACTUAL-CODE","state":"in_progress"}]}`。可用 state：not_started/in_progress/awaiting_review/blocked/completed。
- 项目大状态：project update 的 `set.projectStatus` 使用项目 status 目录已有 code，不把流程名称直接当 code。

以上更新均带 `--project-id ID --input FILE --expected-revision R`，使用 OperationRequest 信封及对应 operation（project.update/masterdata.update），data 含 schemaVersion:"1.0.0" 与 changes。普通窄更新不带 --compact。

登记公司评审、关闭条件或跟进时才读取 [评审证据](references/reviews.md)。不要用 ssr update 覆写 submissions。当前 CLI 不提供 reviewGates 写接口，不虚构 workflow update 命令。

指定节点在项目配置中不存在时，先澄清要采用哪个现有节点或是否新增，不凭名称猜 code。缺少实际评审提交记录时，不能凭空创建申请号或将跟进写到不存在的 submission：先完成已明确的进度更新，再索取实际申请/提交信息。此时应说明跟进日期尚未登记为提醒，不能只改节点 date/dateZh 就声称提醒已安排。

把 DRB / COST_BASELINE_APPROVAL 节点明确标 completed，或 DRB 通过且条件全闭，会持久锁定项目成本。依据用户提供的实际完成信息记录，不猜审批结果；回退节点不能解锁。Master Data RE 目录仍可维护。

提醒日期是 SSR 的 dueDate/最新 followup.nextDate（YYYY-MM-DD，Asia/Singapore），不是节点展示用的 date/dateZh。`reminders scan --as-of DATE`、`reminders list` 是全局命令，无 --project-id；返回后按 projectId 筛选。`reminders ack --id ID --fingerprint FINGERPRINT` 只标已读，不代表已解决。跟进记录不表示已联系 PM；未经授权不发送消息。

API 运行时每分钟扫描并在重启补扫。用户要求关闭平台后持续提醒时，须另行配置获授权的调度，不能声称 skill 自身常驻。
