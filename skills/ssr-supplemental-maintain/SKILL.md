---
name: ssr-supplemental-maintain
description: 维护指定项目 Master Data 的物流、车辆、其他服务等补充成本参考条目及科目；不直接改项目已计算成本。
---

# SSR · 补充成本主数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

只操作 Master Data 的 `supplemental` 页签：
```sh
cost-cli masterdata get --project-id ID --tab supplemental --id RECORD-ID
cost-cli masterdata update --project-id ID --tab supplemental --input change.json --expected-revision R
```
字段依据：supplementalCostItem（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

记录字段为 `id/code/name/statementCode/defaultAmount/currency/owner/sourceNote/active`。保持稳定 ID 和科目代码；展示名称可以修改。使用已有合法 statementCode，不凭名称猜科目。

defaultAmount 是目录参考值，维护它不表示项目已发生此项费用；项目实际金额需成本更新业务明确处理。
