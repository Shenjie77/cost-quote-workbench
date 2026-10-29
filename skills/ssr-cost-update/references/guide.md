# SSR · 修改成本

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用最新项目 `--expected-revision R`，冲突后重读。局部更新保留未传字段，新增须完整；核对成功回执和变更结果。

先 `cost get --project-id ID --version Vn --section settings` 检查目标版本的 state 和 costLockReason；也可用 `--section versions` 查看每个版本的锁原因。省略 `--version` 才检查/更新 activeVersion，不能用活动版本锁原因判断另一个版本。Confirmed 仅锁对应版本的输入与捕获费率，汇总仍可查看；Draft 不能因进入或完成 DRB 被直接锁死。新一轮估算可用成本新建 skill 从锁版复制 Draft，再改新版的人天、费率、3% 等；不能清锁、降级或删除证据修改原版。

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

人员行可选 `category`（最多 120 字符）是报价分类，`groupName` 是人员分组，两者独立；RE Type 的 `category=internal/subcontract` 则是资源分类，不可混用。已有行用 `upsert:[{id,category}]` 局部改，空字符串清空。成本 Category 带入生成报价的分类边界；名称 Optional 不自动排除金额。整组复制没有单独 CLI 命令：读取明确组的全部成员，按用户指定新组名生成全新 ID，复制 Category、Scope、BU、RE、输入模式与完整五年投入，省略 source，再用 upsert 新增；需插入指定位置时提交完整 order，不覆盖原组。

页面 Bulk Entry 每次打开载入当前记录；保留 Row ID 更新、新行新增、未列出的原行保留，不再恢复已应用旧草稿。CLI 使用相同稳定 ID 的窄接口更新；不要把页面批量更新误当成 cost import 文件追加流程。

分包条目、数量、站型或年度部署更新时读取 [结构化分包](../references/subcontract.md)，使用 `cost get/update --project-id ID --version Vn --section subcontract`。全局目录只提供参考；项目采用的描述、单位和价格必须复制入目标成本版本。该接口的计算结果自动汇入 2.3.2，不另写 rows/manualCosts，也不额外重复加入材料、安装或差旅。

Excel 输入时读取 [TD/PM 导入](../references/import.md)。只改数值时不加载导入说明。完成后窄读目标条目/summary，并 `cost validate --project-id ID --version V1`；按任务需要 calculate 或输出文件。

仅修改费率、3%、差旅或手工费用时读 [成本设置](../references/settings.md)。普通人员行修改不加载。

仅用户要求定稿或删除暂停版本时读 [版本动作](../references/lifecycle.md)；一般编辑和只读查询不触发。
