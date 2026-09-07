---
name: ssr-project-manage
description: 新建 SSR 报价项目、修改项目基本资料、删除或恢复项目；流程进度使用 ssr-workflow-update，成本版本使用 ssr-cost-create。
---

# SSR · 项目管理

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

新建项目必须有用户提供的项目号、名称、客户，使用 `cost-cli project create --input project.json`。这是仅创建命令，不带 expected-revision；已有或已删除的同号项目会拒绝，不能覆盖或自动恢复。
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"project.create","project":{"id":"USER-PROJECT-ID","name":"用户项目名称","client":"用户客户名称"}}}
```
创建返回空白 V1 草稿。默认目录仅为平台初始配置，使用实际成本前核实 RE 费率与 TD 日期；不把默认数据当成公司已批准记录。

修改资料：`project get --project-id ID`，随后 `project update --project-id ID --input change.json --expected-revision R`，只设置 `name/client`。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"project.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

删除须有实际删除请求：`project delete --project-id ID --expected-revision R`。删除可恢复，并保留成本锁和归档。恢复先 `project list --deleted`，然后 `project restore --project-id ID --expected-revision R`，不能自动重建已删除项目。
