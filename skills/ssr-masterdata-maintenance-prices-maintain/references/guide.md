# SSR · 维护维保价格库

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

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

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。
