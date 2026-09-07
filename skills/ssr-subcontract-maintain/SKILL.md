---
name: ssr-subcontract-maintain
description: 维护指定项目 Master Data 分包服务目录、供应商参考条目和成本信息；实际项目分包入账用 ssr-cost-update。
---

# SSR · 分包主数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

只操作 Master Data 的 `subcontract` 页签：
```sh
cost-cli masterdata get --project-id ID --tab subcontract --id RECORD-ID
cost-cli masterdata update --project-id ID --tab subcontract --input change.json --expected-revision R
```
字段依据：subcontractItem（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

按稳定 `id` 合并用户提供的分包目录记录。新记录依 subcontractItem 定义完整填写。相似名称不能视为同一合同/编码；需要用户给出匹配依据才合并。

这里只维护目录参考，不直接插入 Cost Input，不覆盖 PM 已给的实际分包成本。费用包含范围、供应商来源和币种按原始文件保留，不能把一个打包分包再次拆成重复费用。
