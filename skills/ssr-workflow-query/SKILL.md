---
name: ssr-workflow-query
description: 查询流程进度和待办，只读。
---

仓库根目录用 `node cli/cost-cli.mjs`：项目进度执行 `project get --project-id ID --section workflow-plan`；今日待办执行 `digest generate`。未知 ID 才查 project list。按返回节点和期限汇报，不改状态或 ack；历史/异常才读
[操作说明](references/guide.md)。
