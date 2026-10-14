---
name: ssr-masterdata-cpq-catalog-maintain
description: 维护全局公司 CPQ 编码、Scope、单价和数量规则；不匹配项目或求解数量。
---

# SSR · 维护 CPQ 目录

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

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

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。
