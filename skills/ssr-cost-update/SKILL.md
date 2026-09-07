---
name: ssr-cost-update
description: 更新指定 SSR 成本版本的 TD/PM 人天、分包、年度假设、差旅和风险成本，支持 Excel 导入及 Local/ARP 3%；不维护主数据费率。
---

# SSR · 成本更新

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

先 `project get --project-id ID` 检查 `costLockReason`。DRB 完成或任一版本 Confirmed 会锁住全项目成本；不能改状态、清锁、新建版本或删除证据规避。唯一锁后写入例外是用户要求对原样草稿完成定稿时，只提交 `set.state="Confirmed"`，不能夹带成本输入。

读取/修改明确版本：
```sh
cost-cli cost get --project-id ID --version V1 --section rows --id ROW-ID
cost-cli cost update --project-id ID --version V1 --section rows --input change.json --expected-revision R
```
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"cost.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

`rows` 新行必须有 `id/scope/bu/reTypeId/mdPerSite/years`，参照 `schemas/cost-export.schema.json` 的 costRow。修改任一年先读取完整 years，再替换有序 Y1–Y5 全数组。默认站点模式用 Sites × MD/Site；直接人天模式设 `inputMode:"mandays"`，每年填 mandays，sites 与 mdPerSite 为零。内部 Cost 交由共享计算器生成；分包成本按真实合同金额输入。只用目标版本 `--section resources` 中存在的 RE ID。`source` 证据不能手工提交或改写。

`--section settings` 使用 set，字段：`rateSettings/travelSettings/travelUplift/manualCosts/state`。先设置 TD 开始日期；Y1 从该年份起算。打开 `rateSettings.localArpAllowanceEnabled:true` 后，LOCAL/ARP 每年 Cost 已含 3%，Summary/历史/报价/Excel 直接汇总；不要增加 allowance 行或修改主数据费率、人天。关闭则从原始投入与费率重算。HQ、分包、差旅不加该 3%。

`--section travel` 是额外差旅明细；HQ 差旅由 travelSettings 与 HQ 人天计算。避免同一分包/费用重复入账。更新主数据 RE 费率不会重算成本；用户明确要求且未锁定时，才用 `cost apply-rates --project-id ID --version V1 --expected-revision R`。

Excel 输入时读取 [TD/PM 导入](references/import.md)。只改数值时不加载导入说明。完成后窄读目标条目/summary，并 `cost validate --project-id ID --version V1`；按任务需要 calculate 或输出文件。
