---
name: ssr-quote-template
description: 新建或更新项目级客户报价模板的有效期、付款条款、T&C 和默认假设引用；报价文件导出使用 ssr-quote-export。
---

# SSR · 报价模板更新

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

只操作 Master Data 的 `quote-templates` 页签：
```sh
cost-cli masterdata get --project-id ID --tab quote-templates --id RECORD-ID
cost-cli masterdata update --project-id ID --tab quote-templates --input change.json --expected-revision R
```
字段依据：quoteTemplate（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

记录字段包括 `id/name/nameZh/clientPattern/documentTitle/documentTitleZh/validityDays/paymentTerms/paymentTermsZh/termsAndConditions/defaultAssumptionIds/active`。T&C 原文可长文本，不要求编造翻译。defaultAssumptionIds 必须指向该项目假设库已有 ID，只在引用需要核对时读取相应假设条目。

客户匹配按规范化精确名称。此目录是商业条款与默认假设数据，不等于客户提供的 .xlsx 版式文件。修改目录后不要自动选择/应用到当前报价，不改已经导出的历史快照。
