---
name: ssr-assumptions-maintain
description: 维护全局可复用法务 T&C 相关风险、Scope 和交付条件假设库；当前报价采用哪些假设由 ssr-quote-prepare 处理。
---

# SSR · 风险假设库维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

只操作 Master Data 的 `assumptions` 页签：
```sh
cost-cli masterdata get --tab assumptions --id RECORD-ID
cost-cli masterdata update --tab assumptions --input change.json --expected-revision R
```
字段依据：assumptionDefinition（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

字段为 `id/name/category/clientPattern/text/textZh/active`。保留法务及业务原文，不擅自删改责任界面或翻译法律含义。客户匹配是规范化精确匹配，不是正则表达式。

这是可复用库，不是当前报价的 included 假设列表。维护库不代表用户已将新文案纳入报价；当前报价假设另用 quote update --section assumptions。删除库条目前保持报价模板 defaultAssumptionIds 有效，不修改历史报价快照。

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。
