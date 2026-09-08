---
name: ssr-supplemental-maintain
description: 维护全局 Master Data 的物流、车辆、其他服务等补充成本参考条目及科目；不直接改项目已计算成本。
---

# SSR · 补充成本主数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

只操作 Master Data 的 `supplemental` 页签：
```sh
cost-cli masterdata get --tab supplemental --id RECORD-ID
cost-cli masterdata update --tab supplemental --input change.json --expected-revision R
```
字段依据：supplementalCostItem（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

记录字段为 `id/code/name/statementCode/defaultAmount/currency/owner/sourceNote/active`。保持稳定 ID 和科目代码；展示名称可以修改。使用已有合法 statementCode，不凭名称猜科目。

defaultAmount 是目录参考值，维护它不表示项目已发生此项费用；项目实际金额需成本更新业务明确处理。

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。
