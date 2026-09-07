---
name: ssr-cost-create
description: 在已有 SSR 项目中新建空白成本版本或从指定版本复制草稿；用于首次编制或新一轮成本估算，既有版本改值用 ssr-cost-update。
---

# SSR · 成本新建

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

读取 `project get --project-id ID` 的 `costLockReason` 和 `cost get --project-id ID --section versions`。项目成本已锁定时不能新建、克隆或换项目规避锁定。尚无项目且用户要求创建时，先使用项目管理 skill。

空白编制：
```sh
cost-cli cost create --project-id ID --mode blank --expected-revision R
```
复制明确源版本：
```sh
cost-cli cost create --project-id ID --mode clone --source-version V1 --expected-revision R
```
版本号由平台生成，新版本为 Draft，返回 `version`；创建不会切换 activeVersion。之后所有成本命令显式指定返回版本。

空白版本使用当前项目主数据资源，TD 日期留空、费用为零；依据用户给的交付日期、费率和投入编制，不采用臆测日期。克隆保留源版本捕获的资源/费率、成本设置和来源证据，不自动套用最新主数据。用户要求使用新费率时才对未锁定目标版本执行 `cost apply-rates`。

首次输入沿用 `cost get/update --version Vn --section settings|rows`：先设置真实 TD 开始日期，再新增完整 Y1–Y5 成本行。行字段与导入步骤见 [成本输入](../ssr-cost-update/SKILL.md)，仅在需要填写/导入时读取该业务说明。Excel 导入预览与应用均指定新版本。

完成后读取目标版本 settings/summary 并 `cost validate --project-id ID --version Vn`；报告项目号、版本号、空白/来源版本和仍缺的业务输入。新增草稿不代表 DRB 或成本定稿。
