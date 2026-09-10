---
name: ssr-profit-share-maintain
description: 独立维护全局各 BU 的 Profit Share Rate 分成比例；不读取项目或改动历史报价。项目采用比例和目标 Sales GP 定价使用 ssr-quote-prepare。
---

# SSR · BU 分成主数据维护

在仓库根目录用 `npm run --silent cost-cli -- ...`；下文简称 `cost-cli`。仅操作全局 `profit-share` 页签，不要求项目号，不读 `project list` 或 `workspace get`。

1. `cost-cli masterdata get --tab profit-share --limit 1000`，记录该页签 revision；有 nextOffset 时分页读取，revision 变化则重读。
2. 按用户给定 BU 和百分比维护 `{id,bu,ratePercent,active}`。20% 写为 `20`。比例为 0–100，BU 忽略大小写及重复空格后不能重复；未提供的实际比例不能猜测。
3. 将所需变更写入文件，使用 `masterdata update --tab profit-share --input FILE --expected-revision R`。冲突时重读目标页签再修改，不使用项目 revision。
4. 窄读回核对保存结果。维护不会更新已有项目，也不重新计算历史报价。

文件使用标准信封，`CHANGES` 为 `{"upsert":[...],"remove":[...]}`，只包含用户授权的变更：

```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```

新项目捕获创建时的比例；用户明确要求已有项目采用最新比例时，转到 [商业报价编制](../ssr-quote-prepare/SKILL.md)，使用 `project apply-masterdata --project-id ID --tab profit-share --expected-revision PROJECT_R`。该动作只更新当前项目定价快照，成本已确认也可应用，不修改锁定成本或历史报价。
