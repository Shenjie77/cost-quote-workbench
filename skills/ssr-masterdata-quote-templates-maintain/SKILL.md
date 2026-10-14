---
name: ssr-masterdata-quote-templates-maintain
description: 维护全局客户报价模板的有效期、付款条款、T&C 和默认假设引用。
---

# SSR · 维护报价模板

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

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

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。
