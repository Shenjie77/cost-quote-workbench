---
name: ssr-retype-maintain
description: 维护全局 Master Data 的人员 RE Type、LOCAL/ARP/HQ/OTHER 人天费率、等级和换算参数；不更新成本版本。
---

# SSR · RE Type 维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，全局默认 limit 为 100、上限 10000；跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

每个全局页签有独立 revision；写入使用该页签最新返回的 `--expected-revision R`，不能拿项目或另一页签的 revision。冲突后重读该页签再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。读取返回 `GlobalMasterDataResult`，更新返回 `GlobalMasterDataMutationResult`。核对 scope/tab/revision、changedIds/removedIds 与 unresolvedKeys；不把预览或校验当成已保存。

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

全局更新不会改动任何已有项目，包括 Draft；已有成本、报价和归档继续使用其原始快照。迁移发现同编码/ID 不同内容时保留差异与来源，用用户提供的完整条目明确 upsert 解决（冲突条目不能只传局部字段），不猜测哪个项目正确、不静默覆盖冲突。

Category、Pool、Level 独立于编码：internal 必须设置 LOCAL/ARP/HQ/OTHER 之一与 L0–L4；subcontract 的 pool/level 为 null 且 hqTravel 为 false。HQ 人员启用 hqTravel，LOCAL/ARP/OTHER 禁用。这些 hqTravel 标记保留历史兼容，新版成本仍必须显式启用 HQ Travel 才按 HQ 人力计费。OTHER 用于远程支持等不适用 HQ 差旅的自有人员，也可在成本版本中按实际需要选择 3% allowance，仍按本条目的人天费率及年度 uplift 正常计算；Level 仍按实际等级填写。变更分类时一次 upsert 所有依赖字段，保留用户原 code；自定义唯一 code 合法，不要求等于 Pool-Level。页面新增默认 internal/LOCAL/L1，可手动修改种类、Pool、Level 与编码，不能根据编码自动把新条目归为分包。
