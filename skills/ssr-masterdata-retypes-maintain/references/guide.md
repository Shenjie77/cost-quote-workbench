# SSR · 维护人员费率

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

只操作 Master Data 的 `resources` 页签：

```sh
cost-cli masterdata get --tab resources --id RECORD-ID
cost-cli masterdata update --tab resources --input change.json --expected-revision R
```

字段依据：resourceType（schemas/cost-export.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：

```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```

全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

按已有 `id` 更新，可先用 `--query LOCAL-L1` 找到准确 ID。字段包括 `code/name/category/pool/level/mandayRate/mandaysPerMonth/hoursPerManday/hqTravel/effectiveFrom/effectiveTo/active`。人天费率字段是 `mandayRate`，以 SGD/MD 计；当前没有独立的货币汇率或自动换汇引擎，不把币种兑换率写进该字段。有效期按用户资料保存，不因当前年份自动改旧版采用的费率。

示例 changes：`{"upsert":[{"id":"ACTUAL-RE-ID","mandayRate":650}]}`，650 仅为示例，使用用户给定费率。保留其他等级、有效期和换算参数。新增 RE 使用完整 schema 字段。

维护该全局目录与任何项目成本状态无关。该操作不会更改任何成本版本捕获的费率和金额。用户另外要求把新费率应用到某个未锁定版本时，转成本更新 skill 并明确版本；不要自动执行 `cost apply-rates`，也不通过增加费率实现人员 3% allowance；适用的人员 Pool 在成本版本中单独选择。

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。

Category、Pool、Level 独立于编码：internal 必须设置 LOCAL/ARP/HQ/OTHER 之一与 L0–L4；subcontract 的 pool/level 为 null 且 hqTravel 为 false。HQ 人员启用 hqTravel，LOCAL/ARP/OTHER 禁用。这些 hqTravel 标记保留历史兼容，新版成本仍必须显式启用 HQ Travel 才按 HQ 人力计费。OTHER 用于远程支持等不适用 HQ 差旅的自有人员，也可在成本版本中按实际需要选择 3% allowance，仍按本条目的人天费率及年度 uplift 正常计算；Level 仍按实际等级填写。变更分类时一次 upsert 所有依赖字段，保留用户原 code；自定义唯一 code 合法，不要求等于 Pool-Level。页面新增默认 internal/LOCAL/L1，可手动修改种类、Pool、Level 与编码，不能根据编码自动把新条目归为分包。

页面 Bulk Entry 打开当前目录记录及 ID，Validate → Apply changes 更新同一记录，新记录新增、未列出的记录保留；不恢复已应用旧批次。可选文本/列表可直接清空。独立 Import XLSX 的空白字段仍保留原值；CLI 继续按稳定 ID upsert，省略字段表示保留，不能混用这三种输入语义。
