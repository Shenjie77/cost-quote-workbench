---
name: ssr-maintenance-price
description: 按项目 BOQ 的实际设备数量选择维保参考价，编制并导出维保草稿。
---

# SSR · 编制维保报价

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用最新项目 `--expected-revision R`，冲突后重读。局部更新保留未传字段，新增须完整；核对成功回执和变更结果。

读取 `boq get --project-id ID --section rows|settings`，按型号 query `boq get --project-id ID --section references`，使用本项目捕获的参考库。型号需 NFKC/空白/大小写规范化后精确匹配；不能把模糊相似型号当同设备。比较客户、SLA、站点、期限、日期、结果与来源，缺少可用参考就说明缺项。

仅查询跨客户最新维保参考时可窄读 `masterdata get --tab maintenance --query MODEL`；它不是本项目已采用的数据。用户明确要求采用最新库时，才 `project apply-masterdata --project-id ID --tab maintenance --expected-revision R`，然后核对本项目 references 和现有 BOQ 选择；归档保留原快照，不自动替用户选价。

Excel BOQ：`workbook inspect --file BOQ.xlsx`，按真实列生成 OperationRequest，data 的 operation 为 `boq.import`、mapping 为 `{sheet,headerRow,modelColumn,quantityColumn,excludeRows?}`。运行 `boq import --project-id ID --file BOQ.xlsx --input mapping.json` 预览，再同参添加 `--apply --expected-revision R --compact`。排除汇总行；导入不是覆盖旧 BOQ，同一设备批次不可重复计数。

`project apply-masterdata` 仅允许当前 activeVersion 为未锁定 Draft 的项目；指定成本版本费率则用 `cost apply-rates --version`。若当前版本已定稿，先按用户的新一轮估算意图建立新 Draft，保持原版与历史归档不变。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"boq.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。
`boq update --section settings` 的 set 只有 `coverageMonths`；`--section rows` upsert 字段为 `id/model/quantity/serviceLevel/site/referenceId/unitAnnualQuote/basis/source`，完整字段见 workspace-state schema 的 boqLine。quantity 必须实际设备数量，不为匹配金额而调整。原始导入型号/数量的证据由平台保留，不能伪造。

单位年参考价采用平台领域计算；金额/期限/数量任一关键数据无效时不可用。记录选择理由、报价差异与 unitAnnualQuote，维护库不等于已选参考。

```sh
cost-cli maintenance archive --project-id ID --expected-revision R --compact
cost-cli maintenance export --project-id ID --archive-id ARCHIVE-ID --output outputs/Maintenance-new.xlsx
```
归档覆盖当前全部 BOQ 行并保存参考快照。核对总成本/报价与输出路径。输出是维保草稿，不含内部参考成本，不代表已审批或已发送客户；税费、最终 T&C 和正式报价走商业报价流程。
