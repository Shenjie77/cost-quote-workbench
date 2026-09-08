---
name: ssr-quote-template
description: 新建或更新全局客户报价模板的有效期、付款条款、T&C 和默认假设引用；报价文件导出使用 ssr-quote-export。
---

# SSR · 报价模板更新

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

只操作 Master Data 的 `quote-templates` 页签：
```sh
cost-cli masterdata get --tab quote-templates --id RECORD-ID
cost-cli masterdata update --tab quote-templates --input change.json --expected-revision R
```
字段依据：quoteTemplate（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

记录字段包括 `id/name/nameZh/clientPattern/documentTitle/documentTitleZh/validityDays/paymentTerms/paymentTermsZh/termsAndConditions/defaultAssumptionIds/active`。T&C 原文可长文本，不要求编造翻译。defaultAssumptionIds 必须指向全局假设库已有 ID，只在引用需要核对时读取相应假设条目。

客户匹配按规范化精确名称。此目录是商业条款与默认假设数据，不等于客户提供的 .xlsx 版式文件。修改目录后不要自动选择/应用到当前报价，不改已经导出的历史快照。

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。
