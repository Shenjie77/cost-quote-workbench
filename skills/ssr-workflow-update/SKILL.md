---
name: ssr-workflow-update
description: 更新项目当前流程节点、节点进度，登记 DTRB/DRB/概算/专业/投标/报价评审证据及跟进日期；流程结构维护使用 ssr-workflow-configure。
---

# SSR · 流程与评审更新

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

项目号已知先 `project get --project-id ID`，核对当前 workflowVersion 与查看中的 activeVersion。按需用 `cost get --project-id ID --version Vn --section workflow` 窄读本版流程结构与进度，查看旧版时也明确版本；再按需读 `ssr get --section settings` 或 `ssr get --section submissions --id SUBMISSION-ID`，都带同项目号。流程定义维护才读 `masterdata get --tab workflow --id CODE`。每版有独立 DTRB → DRB 轮次；创建新 Draft 会自动选中新版并回到该版 DTRB，旧版记录保留。切换 activeVersion 查看历史不改变当前工作轮次。workflowVersion/versionWorkflows 由平台管理，不能通过 workspace 手工移动轮次或拷贝完成状态。

当前节点、节点 state、SSR 评审证据是不同记录，不能把其中一个当成其他记录已完成的证明。普通节点进度围绕当前 workflowVersion 更新，不能因正在查看旧版就把新轮次进度写到旧版。根据实际叙述只更新应变字段；“到 DRB”不等于“DRB 已通过”：
- 当前节点：`project update`，changes 为 `{"set":{"currentWorkflowStepCode":"ACTUAL-CODE"}}`。
- 节点进度：`masterdata update --tab workflow`，changes 为 `{"upsert":[{"code":"ACTUAL-CODE","state":"in_progress"}]}`。可用 state：not_started/in_progress/awaiting_review/blocked/completed。
- 项目大状态：project update 的 `set.projectStatus` 使用项目 status 目录已有 code，不把流程名称直接当 code。

以上更新均带 `--project-id ID --input FILE --expected-revision R`，使用 OperationRequest 信封及对应 operation（project.update/masterdata.update），data 含 schemaVersion:"1.0.0" 与 changes。普通窄更新不带 --compact。

登记公司评审、关闭条件或跟进时才读取 [评审证据](references/reviews.md)。不要用 ssr update 覆写 submissions。当前 CLI 不提供 reviewGates 写接口，不虚构 workflow update 命令。

指定节点在项目配置中不存在时，先澄清要采用哪个现有节点或是否新增，不凭名称猜 code。缺少实际评审提交记录时，不能凭空创建申请号或将跟进写到不存在的 submission：先完成已明确的进度更新，再索取实际申请/提交信息。此时应说明跟进日期尚未登记为提醒，不能只改节点 date/dateZh 就声称提醒已安排。

进入、提交或完成 DRB 前，先 `cost get --project-id ID --version Vn --section settings` 和 `--section summary` 核对本版成本，并完成校验。本版须已由用户明确确认成为 Confirmed；若尚未获得定稿授权，先呈现该版汇总，请用户确认后再交成本更新 skill 定稿。用户已经明确授权本版定稿时无需重复询问。不能把“进入 DRB”、设置 completed 或收到评审结果当成用户确认，也不能让 Draft 被 DRB 直接锁死。Confirmed 只确认成本，不表示 DRB approved；评审结果仍按真实公司证据登记。

SSR 提交用 `ssr submit --project-id ID --version Vn --input FILE --expected-revision R --compact` 明确目标；省略版本时使用 workflowVersion，兼容旧数据缺失该字段时才用 activeVersion。每版分别满足本版 DTRB → DRB 前置，不能以旧版已通过 DTRB 代替新版评审。结果、关闭条件和跟进仍按 submissionId 指向原记录。用户可从锁版创建可编辑新版，原汇总与历史审批保留；不清锁或修改旧证据来推进新轮次。

提醒日期是 SSR 的 dueDate/最新 followup.nextDate（YYYY-MM-DD，Asia/Singapore），不是节点展示用的 date/dateZh。`reminders scan --as-of DATE`、`reminders list` 是全局命令，无 --project-id；返回后按 projectId 筛选。`reminders ack --id ID --fingerprint FINGERPRINT` 只标已读，不代表已解决。跟进记录不表示已联系 PM；未经授权不发送消息。

API 运行时每分钟扫描并在重启补扫。用户要求关闭平台后持续提醒时，须另行配置获授权的调度，不能声称 skill 自身常驻。

收到旧版 DRB 结果时，按实际 submissionId 登记原版结果，不修改新轮次成本或将新版标为已批准。遇到历史快照不再适用的记录，应保留原证据并说明适用版本，不能借登记结果替新版定稿。
