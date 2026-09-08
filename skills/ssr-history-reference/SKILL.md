---
name: ssr-history-reference
description: 查找相似 Scope 的历史服务总成本，或按设备/客户比较维保历史价格；只读检索与对比，不更改成本、目录或报价。
---

# SSR · 历史成本参考

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。服务历史用跨项目 history search，维保历史用全局 maintenance 页签；两者都不以 project list/get 为前置。只有需要查看某个候选项目的具体版本时才窄读该项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

服务历史：
```sh
cost-cli history search --scope "实际简短 Scope" --client "可选客户"
```
不限定客户时省略 --client。该命令跨本地项目检索，不带 --project-id；结果包含项目、版本、原 Scope、总成本、人天和来源。词面相似不是相同交付范围。比较实际 Scope、规模、期限、服务条件及日期差异，参考结论明确依据。

按用户要求，历史成本展示只使用结果的最终总成本；不要拆基础成本/3% allowance，不再加3%。缺少可比范围时说明参考限制，不机械套价。

维保历史跨客户检索全局参考库，使用 `masterdata get --tab maintenance --query MODEL`，无需项目号，再按真实型号规范化精确匹配和客户/SLA/站点/期限筛选。同设备不同客户分别比较，保留报价日期、结果与来源。单位年价采用平台的 unitAnnualMaintenanceQuote/Cost 领域函数，不能把缺数量/期限当作零价。

只读任务不写项目状态、历史记录、BOQ 参考选择或报价。返回可复用的候选和差异说明，用户需要采用时再进入相应成本或维保业务。
