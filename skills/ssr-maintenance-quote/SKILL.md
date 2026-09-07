---
name: ssr-maintenance-quote
description: 按产品 BOQ 实际设备数量选择客户/型号维保参考价，计算维保草稿并归档导出；历史参考库录入使用 ssr-maintenance-data。
---

# SSR · 维保配置与报价

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

读取 `boq get --project-id ID --section rows|settings`，按型号 query `masterdata get --project-id ID --tab maintenance`。型号需 NFKC/空白/大小写规范化后精确匹配；不能把模糊相似型号当同设备。比较客户、SLA、站点、期限、日期、结果与来源，缺少可用参考就说明缺项。

Excel BOQ：`workbook inspect --file BOQ.xlsx`，按真实列生成 OperationRequest，data 的 operation 为 `boq.import`、mapping 为 `{sheet,headerRow,modelColumn,quantityColumn,excludeRows?}`。运行 `boq import --project-id ID --file BOQ.xlsx --input mapping.json` 预览，再同参添加 `--apply --expected-revision R --compact`。排除汇总行；导入不是覆盖旧 BOQ，同一设备批次不可重复计数。

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
