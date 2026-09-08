---
name: ssr-workflow-configure
description: 维护全局流程默认模板的节点名称、责任人、输入要求及状态字典；不更改已有项目进度或评审证据，进度更新用 ssr-workflow-update。
---

# SSR · 流程配置维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

`masterdata --tab workflow` 维护未来项目采用的全局流程默认模板，`--tab status` 维护全局状态字典。当前项目节点进度和 DTRB/DRB 证据另由流程更新 skill 处理。

```sh
cost-cli masterdata get --tab workflow --id NODE-CODE
cost-cli masterdata update --tab workflow --input change.json --expected-revision R
```
状态字典使用相同命令换成 `--tab status`。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

两种记录都以 code 为键。流程节点字段按 workspace-state schema 的 workflowStep；状态字典字段为 `code/name/nameZh/active`。名称可以改，稳定 code 应保留。新增节点需完整字段，模板只保留未开始的初态和默认责任/输入要求，不填项目实际日期、完成状态或评审证据。全局模板的修改不会重写任何已有项目的当前节点、版本流程或已批准记录。

已有项目的节点进度、当前节点和状态通过 [流程与评审更新](../ssr-workflow-update/SKILL.md) 维护；不拿全局模板更新代替实际进度。用户确认成本为 Confirmed 才可进入本版 DRB，新 Draft 有独立 DTRB 轮次；模板维护不能改变这些规则或解除成本锁。

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。
