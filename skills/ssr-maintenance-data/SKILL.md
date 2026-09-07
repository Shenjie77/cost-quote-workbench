---
name: ssr-maintenance-data
description: 维护设备型号、客户、SLA、期限、数量及历史维保成本/报价参考库；用于历史数据录入修正，BOQ 定价用 ssr-maintenance-quote。
---

# SSR · 维保数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

只操作 Master Data 的 `maintenance` 页签：
```sh
cost-cli masterdata get --project-id ID --tab maintenance --id RECORD-ID
cost-cli masterdata update --project-id ID --tab maintenance --input change.json --expected-revision R
```
字段依据：maintenancePriceRecord（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

每条记录保留 `id/client/service/productModel/serviceLevel/site/coverageMonths/quantity/costAmount/quotedAmount/currency/quoteDate/outcome/source`。outcome 仅为 Quoted/Won/Lost/Reference，按真实结果填写，不推断成交。

按设备型号＋客户＋SLA＋期限/日期识别记录，不能把不同客户或服务条件的同型号覆盖为一条。数量和期限必须来自原始材料；分母缺失或无效时单设备年价不可用，不能作为免费报价。跨客户对比用平台维保计算，单位年价基于 amount × 12 ÷ months ÷ quantity。

Excel 先 `workbook inspect` 核对真实列，再转为当前 schema 的 upsert；`maintenance validate` 只校验 MaintenancePriceRequest，并不保存。持久化必须使用本 skill 的 masterdata update。历史归档不可改写。
