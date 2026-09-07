---
name: ssr-cpq-catalog
description: 维护自建平台内公司 CPQ 编码、Scope、单价及数量规则目录；不匹配项目 Scope、不确认条目、不计算配置数量。
---

# SSR · CPQ 数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

CPQ 目录用 `cpq` 模块，不是 masterdata 的页签：
```sh
cost-cli cpq get --project-id ID --section catalog --id CODE
cost-cli cpq update --project-id ID --section catalog --input change.json --expected-revision R
```
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"cpq.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

目录记录以 `code` 为键：`scope/unit/unitCost/kind/adjustable/active/step/minQty/maxQty/referenceQty/tags/revision`，详见 `features/cpq/domain.ts` CatalogItem 和 workspace-state schema 的 cpqCatalogItem 定义。tags 和 revision 是字符串，adjustable/active 是布尔值，单价与数量参数是数字。新增公司编码必须来自用户文件或真实目录，不编造。

`kind` 为 equipment/service。设备不可调；固定服务也可不可调。数量上下限、步长与参考数量按公司规则维护，不能扩大边界来凑项目目标成本。金额采用 SGD，其他币种须先明确处理口径。

改变已选条目的费用或数量规则可能使草稿确认/求解失效；报告该影响，不自动重新确认用户选择、不自动 solve/archive。已归档结果及其成本快照保持不变。匹配和计算使用 CPQ 配置 skill。
