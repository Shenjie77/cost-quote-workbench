---
name: ssr-maintenance-data
description: 维护全局设备型号、客户、SLA、期限、数量及历史维保成本/报价参考库；用于历史数据录入修正，BOQ 定价用 ssr-maintenance-quote。
---

# SSR · 维保数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

只操作 Master Data 的 `maintenance` 页签：
```sh
cost-cli masterdata get --tab maintenance --id RECORD-ID
cost-cli masterdata update --tab maintenance --input change.json --expected-revision R
```
字段依据：maintenancePriceRecord（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

每条记录保留 `id/client/service/productModel/serviceLevel/site/coverageMonths/quantity/costAmount/quotedAmount/currency/quoteDate/outcome/source`。outcome 仅为 Quoted/Won/Lost/Reference，按真实结果填写，不推断成交。

按设备型号＋客户＋SLA＋期限/日期识别记录，不能把不同客户或服务条件的同型号覆盖为一条。数量和期限必须来自原始材料；分母缺失或无效时单设备年价不可用，不能作为免费报价。跨客户对比用平台维保计算，单位年价基于 amount × 12 ÷ months ÷ quantity。

Excel 先 `workbook inspect` 核对真实列，再转为当前 schema 的 upsert；`maintenance validate` 只校验 MaintenancePriceRequest，并不保存。持久化必须使用本 skill 的 masterdata update。历史归档不可改写。

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。
