# SSR · 维护补充成本目录

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

只操作 Master Data 的 `supplemental` 页签：
```sh
cost-cli masterdata get --tab supplemental --id RECORD-ID
cost-cli masterdata update --tab supplemental --input change.json --expected-revision R
```
字段依据：supplementalCostItem（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

记录字段为 `id/code/name/statementCode/defaultAmount/currency/owner/sourceNote/active`。保持稳定 ID 和科目代码；展示名称可以修改。使用已有合法 statementCode，不凭名称猜科目。

defaultAmount 是目录参考值，维护它不表示项目已发生此项费用；项目实际金额需成本更新业务明确处理。

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。
