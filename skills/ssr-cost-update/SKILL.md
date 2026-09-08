---
name: ssr-cost-update
description: 更新指定 SSR 成本版本的 TD/PM 人天、分包、年度假设、差旅和风险成本，支持 Excel 导入、按人员 Pool 选择 3% 和可选 HQ 差旅；不维护主数据费率。
---

# SSR · 成本更新

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

先 `cost get --project-id ID --version Vn --section settings` 检查目标版本的 state 和 costLockReason；也可用 `--section versions` 查看每个版本的锁原因。省略 `--version` 才检查/更新 activeVersion，不能用活动版本锁原因判断另一个版本。Confirmed 仅锁对应版本的输入与捕获费率，汇总仍可查看；Draft 不能因进入或完成 DRB 被直接锁死。新一轮估算可用成本新建 skill 从锁版复制 Draft，再改新版的人天、费率、3% 等；不能清锁、降级或删除证据修改原版。

定稿前窄读本版 settings/summary 并完成成本校验，向用户呈现可核对的版本和计算总成本。仅在用户明确确认本版定稿后，用 `cost update --project-id ID --version Vn --section settings` 提交 `{"set":{"state":"Confirmed"}}`；若用户已明确授权该版定稿，无需重复询问。普通成本更新、导入或“进入 DRB”不能当成定稿授权。Confirmed 只定稿成本，不代作 DRB approved；配置 requiresConfirmedCost 的节点（默认包括 DRB）要求该版成本先确认；公司进展通过统一流程记录，不再另建 SSR 审批单。

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

`rows` 只录入人员投入，新行必须有 `id/scope/bu/reTypeId/mdPerSite/years`，参照 `schemas/cost-export.schema.json` 的 costRow。修改任一年先读取完整 years，再替换有序 Y1–Y5 全数组。默认站点模式用 Sites × MD/Site；直接人天模式设 `inputMode:"mandays"`，每年填 mandays，sites 与 mdPerSite 为零。内部 Cost 交由共享计算器生成，只选择目标版本 resources 中 category=internal 的 RE ID。分包使用下述独立入口，不能通过 category=subcontract 的 RE Type 新增或修改手输金额。`source` 证据不能手工提交或改写。

分包条目、数量、站型或年度部署更新时读取 [结构化分包](references/subcontract.md)，使用 `cost get/update --project-id ID --version Vn --section subcontract`。全局目录只提供参考；项目采用的描述、单位和价格必须复制入目标成本版本。该接口的计算结果自动汇入 2.3.2，不另写 rows/manualCosts，也不额外重复加入材料、安装或差旅。

`--section settings` 使用 set，字段：`rateSettings/travelSettings/travelUplift/manualCosts/state`。先设置 TD 开始日期；Y1 从该年份起算。3% 用 `rateSettings.allowancePools:["LOCAL","ARP"]` 选择人员 Pool；LOCAL/ARP/HQ/OTHER 均可选择，适用于本版资源快照中归属该 Pool 的所有 internal 人员。数组整体替换：增加/移除某 Pool 前先保留当前其他选择，`[]` 明确关闭。所选 Pool 的人员每年 Cost 已含 3%，Summary/历史/报价/Excel 直接汇总；不要增加 allowance 行或修改主数据费率、人天。关闭后从原始投入与费率重算。分包、差旅和手工费用不套该 3%。

HQ 差旅需要 `travelSettings.enabled:true`，按本版 internal/HQ 的人天折算人月，再计月补贴与手工录入的往返机票；`false` 时补贴和机票成本均为 0，保留已录入参数。不因发现 HQ 人力而自动启用。新空白成本默认 allowancePools 为 []、HQ Travel 为 false；历史版本缺少 Pool 字段时保留原有 `allowanceResourceTypeIds` 精确选择，若 ID 字段也缺少则沿用 `localArpAllowanceEnabled`。克隆保留源版设置，不主动补写或改变历史金额。新操作使用 Pool 数组；旧版部分 RE Type 的选择不能仅因查看页面而扩展到整个 Pool，用户主动更改 Pool 后才按所选类别整体计算。

`--section travel` 是额外差旅明细；HQ 差旅使用上述显式开关与 HQ 人天计算。避免同一分包/费用重复入账。更新主数据 RE 费率不会重算成本；用户明确要求且指定目标版本未锁定时，才用 `cost apply-rates --project-id ID --version V1 --expected-revision R`；它显式从最新全局 resources 捕获费率，只更新该版本的费率快照和计算金额，旧锁版保持不变。

Excel 输入时读取 [TD/PM 导入](references/import.md)。只改数值时不加载导入说明。完成后窄读目标条目/summary，并 `cost validate --project-id ID --version V1`；按任务需要 calculate 或输出文件。

Cost Statement 2.3.1 继续自动汇总自有人力、非自有人力和 HQ 差旅。2.3.4.2 新空白成本默认按该合计的 1% 计算（分包不计入基数），对应 `manualCosts.otherServiceRate:0.01`。仅设置 `{"set":{"manualCosts":{"otherService":123.45}}}` 会切换为手动金额；设置 `{"set":{"manualCosts":{"otherServiceRate":0.01}}}` 恢复自动。比例是 0–1 小数；不能把 1 写成 1%。旧版本未保存比例字段时沿用原手工金额，克隆保持原模式，不主动改历史金额。

用户要求删除暂停的垃圾版本时，先窄读 `cost get --project-id ID --section versions`，确认指定版本为 Suspended、未锁定且项目至少还有一个其他版本，再运行 `cost delete --project-id ID --version Vn --expected-revision R`。不要通过 workspace.save 删除条目或清理评审证据。操作从工作列表移除版本、保留不可变历史快照，版本号不复用。可用 `cost get --project-id ID --section deleted-versions` 查看已删除目录，或 `--section archive --version Vn` 只读追溯完整快照。
