---
name: ssr-query-cost
description: 查询指定 SSR 项目的成本总额、科目或明细，例如“查 xx 项目成本”；只读，不编制或导出。
---

# SSR · 查询项目成本

在仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`。已知项目 ID 直接执行：

```sh
node --disable-warning=ExperimentalWarning cli/cost-cli.mjs cost get --project-id ID --section summary
```

用户指定版本时追加 `--version Vn`，否则读取 activeVersion，使用回执的项目号和版本，不猜测最新版。只提供名称时先运行 `project list`，从结果匹配名称/客户/ID；唯一匹配后读取 summary。重名则展示候选，请用户选定。已知 ID 无需先查项目列表。

成功回执的 `data.value.totalWithRisk` 是含风险总成本，`sales` 是风险前合计；`inHouseLabour/subcontract/travel` 为自有人力/分包/HQ 差旅分项。summary 是平台计算好的科目金额，不重复加总小计、不再加 3% 或 HQ 差旅。直接报告项目、版本、SGD 总成本及用户所需分项；零成本与查询失败须区分。

仅追问明细时读取同一版本的 `--section rows|subcontract|travel`（每次一个 section）；rows 按需 `--query/--limit/--offset` 并跟随 nextOffset。询问版本状态才读 `--section versions`。跨调用 revision 变化时重读需要一起比较的数据。

本查询到此完成：不先读其他 skill、全量 workspace、schema 或能力表，不运行 validate/calculate/export，不检查写入锁或开启定稿流程。接口确实报错时才按错误查相应命令帮助。
