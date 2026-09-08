---
name: ssr-cost-create
description: 在已有 SSR 项目中新建空白成本版本或从指定版本复制草稿；用于首次编制或新一轮成本估算，既有版本改值用 ssr-cost-update。
---

# SSR · 成本新建

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

读取 `project get --project-id ID` 确认项目，再读 `cost get --project-id ID --section versions` 查看各版本及其 `costLockReason`。成本锁属于版本；已有锁定版本仍可新建空白 Draft，或从指定锁定版本复制新 Draft。新版本可修改，原锁定版本保持原样且汇总可查看。尚无项目且用户要求创建时，先使用项目管理 skill。

空白编制：
```sh
cost-cli cost create --project-id ID --mode blank --expected-revision R
```
复制明确源版本：
```sh
cost-cli cost create --project-id ID --mode clone --source-version V1 --expected-revision R
```
版本号由平台生成，新版本为 Draft，返回 `version`；创建会自动将新版设为 activeVersion 和当前 workflowVersion，并启动该版 DTRB 轮次。之后成本修改、导入和导出仍显式指定返回版本。历史版本及其流程/审批记录保留；切换 activeVersion 查看旧版不改变正在办理的工作轮次。workflowVersion 与 versionWorkflows 由平台管理，不通过 workspace 手写修改。

空白版本捕获创建时的最新全局主数据资源，TD 日期留空、费用为零；依据用户给的交付日期、费率和投入编制，不采用臆测日期。克隆保留源版本捕获的资源/费率、成本设置和来源证据，不自动套用最新主数据。用户明确要求从最新全局主数据采用新费率时，才对未锁定目标版本执行 `cost apply-rates`。

首次输入沿用 `cost get/update --version Vn --section settings|rows`：先设置真实 TD 开始日期，再新增完整 Y1–Y5 成本行。行字段与导入步骤见 [成本输入](../ssr-cost-update/SKILL.md)，仅在需要填写/导入时读取该业务说明。Excel 导入预览与应用均指定新版本。

完成后读取目标版本 settings/summary，并按需用 `cost get --project-id ID --version Vn --section workflow` 核对新版 DTRB 轮次；完成成本输入后用 `cost validate --project-id ID --version Vn` 核验；报告项目号、版本号、空白/来源版本和仍缺的业务输入。新增草稿从本版 DTRB 开始，不继承源版本的锁或旧审批。成本须经用户明确确认成为 Confirmed 后，才能进入、提交或完成本版 DRB；不能用 DRB 状态把 Draft 直接锁死。Confirmed 只表示成本定稿，不表示 DRB 已批准。公司 SSR 前置依赖按版本校验，旧审批仍属于原提交快照。

捕获所需全局页签存在未解决来源冲突时，创建/应用会拒绝。报告页签和编码，由对应维护 skill 根据用户提供的完整正确条目解决；不要从任意旧项目挑值绕过。

新空白项目/成本的 2.3.4.2 默认 `otherServiceRate:0.01`，按 2.3.1 人力成本合计计算；零人力时金额为零。克隆严格保留源版的比例或手工模式。清理暂停版本转成本更新 skill 的 `cost delete`，不要修改版本数组或复用已删除编号。
