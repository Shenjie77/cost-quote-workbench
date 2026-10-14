---
name: ssr-configure-cpq
description: 按项目 Scope 匹配 CPQ 条目，采用用户选项，求解服务数量并归档配置结果。
---

# SSR · 配置项目 CPQ

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用最新项目 `--expected-revision R`，冲突后重读。局部更新保留未传字段，新增须完整；核对成功回执和变更结果。

先读 `cpq get --project-id ID`，按需 `cost get --project-id ID --version Vn --section summary`。保留原始短 Scope，不要求 TD 编造详细分解。用 `cpq match --project-id ID --scope "简短描述"` 与按 query 的 `cpq get --project-id ID --section catalog` 读取，依本项目捕获目录解释候选，词面分数不等于匹配置信度。

全局目录维护另用 CPQ 数据维护 skill，不会改变本项目可用目录。用户明确要求本项目采用最新目录时，先按需读 `masterdata get --tab cpq-catalog`，再 `project apply-masterdata --project-id ID --tab cpq-catalog --expected-revision R`。这是项目快照写入，使用项目 revision；应用后需重新核对已选条目、确认及求解结果。旧归档不变；旧 `cpq update --section catalog` 不可写。

先列候选编码、Scope、匹配理由和待确认条件。用户已有选择授权时继续；否则等待用户选择再保存/确认，不替用户作 confirmer。缺真实设备数量不能倒推金额凑数。

`project apply-masterdata` 仅允许当前 activeVersion 为未锁定 Draft 的项目；指定成本版本费率则用 `cost apply-rates --version`。若当前版本已定稿，先按用户的新一轮估算意图建立新 Draft，保持原版与历史归档不变。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"cpq.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。
`cpq update --section draft` 使用 set：`brief/costVersion/targetCost/targetBasis/tolerance/rounding/allocationBasis`。`--section selections` 使用 upsert：`code/quantity/locked/weight/reason`。每次带项目号、input 和最新 expected-revision。目标成本以明确版本总成本或用户指定口径记录；允许只提供短描述。

用户确认后依次：
```sh
cost-cli cpq confirm --project-id ID --confirmed-by USER --expected-revision R --compact
cost-cli cpq solve --project-id ID --expected-revision NEXT-R --compact
cost-cli cpq archive --project-id ID --expected-revision NEXT-R --compact
cost-cli cpq export --project-id ID --archive-id ARCHIVE-ID --output outputs/CPQ-new.xlsx
```
只调已确认的可调服务。固定设备/固定服务数量必须真实。分配优先使用已知参考数量或目录默认值；缺预算比例时记录所用假设。选定条目、目录条款或固定数量变化需重新确认；仅目标金额变化可保留有效选项确认。

报告数量、总额、差额和 tolerance。`searchComplete=false` 不能证明无解。只有当前可接受结果才归档；未解决差额保留草稿。归档与成本版本一起保存，不能修改旧归档。这里只记录自建平台，不声称已提交公司 CPQ。
