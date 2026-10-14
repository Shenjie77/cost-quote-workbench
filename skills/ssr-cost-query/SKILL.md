---
name: ssr-cost-query
description: 查询项目成本，只读。
---

仓库根目录执行 `node cli/cost-cli.mjs cost get --project-id ID --section summary`。指定版本加 `--version Vn`；否则用活动版。仅有名称先 `project list` 匹配，重名需选择。回执 totalWithRisk 是含风险总成本，不重复加总。普通查询无需其他文件；明细/异常才读
[操作说明](references/guide.md)。
