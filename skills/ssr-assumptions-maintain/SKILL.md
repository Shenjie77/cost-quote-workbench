---
name: ssr-assumptions-maintain
description: 维护项目级可复用法务 T&C 相关风险、Scope 和交付条件假设库；当前报价采用哪些假设由 ssr-quote-prepare 处理。
---

# SSR · 风险假设库维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

只操作 Master Data 的 `assumptions` 页签：
```sh
cost-cli masterdata get --project-id ID --tab assumptions --id RECORD-ID
cost-cli masterdata update --project-id ID --tab assumptions --input change.json --expected-revision R
```
字段依据：assumptionDefinition（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

字段为 `id/name/category/clientPattern/text/textZh/active`。保留法务及业务原文，不擅自删改责任界面或翻译法律含义。客户匹配是规范化精确匹配，不是正则表达式。

这是可复用库，不是当前报价的 included 假设列表。维护库不代表用户已将新文案纳入报价；当前报价假设另用 quote update --section assumptions。删除库条目前保持报价模板 defaultAssumptionIds 有效，不修改历史报价快照。
