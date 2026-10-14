---
name: ssr-history-search
description: 按相似 Scope 或设备客户检索历史成本和维保价格；查指定项目当前成本不使用。
---

# SSR · 查历史参考

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。服务历史用跨项目 history search，维保历史用全局 maintenance 页签；两者都不以 project list/get 为前置。只有需要查看某个候选项目的具体版本时才窄读该项目。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

服务历史：
```sh
cost-cli history search --scope "实际简短 Scope" --client "可选客户"
```
不限定客户时省略 --client。该命令跨本地项目检索，不带 --project-id；结果包含项目、版本、原 Scope、总成本、人天和来源。词面相似不是相同交付范围。比较实际 Scope、规模、期限、服务条件及日期差异，参考结论明确依据。

按用户要求，历史成本展示只使用结果的最终总成本；不要拆基础成本/3% allowance，不再加3%。缺少可比范围时说明参考限制，不机械套价。

维保历史跨客户检索全局参考库，使用 `masterdata get --tab maintenance --query MODEL`，无需项目号，再按真实型号规范化精确匹配和客户/SLA/站点/期限筛选。同设备不同客户分别比较，保留报价日期、结果与来源。单位年价采用平台的 unitAnnualMaintenanceQuote/Cost 领域函数，不能把缺数量/期限当作零价。

只读任务不写项目状态、历史记录、BOQ 参考选择或报价。返回可复用的候选和差异说明，用户需要采用时再进入相应成本或维保业务。
