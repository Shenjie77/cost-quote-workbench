---
name: ssr-cpq-catalog
description: 维护全局公司 CPQ 编码、Scope、单价及数量规则目录；不匹配项目 Scope、不确认条目、不计算配置数量。
---

# SSR · CPQ 数据维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

CPQ 目录是全局 Master Data 的 `cpq-catalog` 页签：
```sh
cost-cli masterdata get --tab cpq-catalog --id CODE
cost-cli masterdata update --tab cpq-catalog --input change.json --expected-revision R
```
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

目录记录以 `code` 为键：`scope/unit/unitCost/kind/adjustable/active/step/minQty/maxQty/referenceQty/tags/revision`，详见 `features/cpq/domain.ts` CatalogItem 和 workspace-state schema 的 cpqCatalogItem 定义。tags 和 revision 是字符串，adjustable/active 是布尔值，单价与数量参数是数字。新增公司编码必须来自用户文件或真实目录，不编造。

`kind` 为 equipment/service。设备不可调；固定服务也可不可调。数量上下限、步长与参考数量按公司规则维护，不能扩大边界来凑项目目标成本。金额采用 SGD，其他币种须先明确处理口径。

已有项目的 CPQ 目录、草稿及归档保留原快照，全局改价不会改变它们。`cpq get --project-id ID --section catalog` 只读项目捕获目录；旧 `cpq update --section catalog` 已拒绝写入。匹配和计算使用 CPQ 配置 skill，不在目录维护时自动 confirm/solve/archive。

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。
