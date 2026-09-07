---
name: ssr-workflow-configure
description: 维护项目级流程节点名称、责任人、输入要求以及状态字典；保持当前实际进度和评审证据，进度更新用 ssr-workflow-update。
---

# SSR · 流程配置维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

平台当前没有独立全局流程模板库。`masterdata --tab workflow` 实际保存指定项目的 processSteps，`--tab status` 保存项目状态字典，不能称为全公司配置。

```sh
cost-cli masterdata get --project-id ID --tab workflow --id NODE-CODE
cost-cli masterdata update --project-id ID --tab workflow --input change.json --expected-revision R
```
状态字典使用相同命令换成 `--tab status`。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

两种记录都以 code 为键。流程节点字段按 workspace-state schema 的 workflowStep；状态字典字段为 `code/name/nameZh/active`。维护节点名称、责任人、输入/说明和 required 等结构时保留实际 state、日期和当前节点。新增节点需完整字段；新增初态按未开始，不复制其他项目的完成状态或评审证据。

名称可以改，稳定 code 应保留。当前选用节点/状态不能直接删除；确需移除时先按用户明确意图调整引用，并逐次使用最新 revision。不要把“模板更新”变成 completed 状态写入；完成 DRB/成本基线节点会锁成本。无论如何不得通过改节点名/code/state 绕过已有成本锁。
