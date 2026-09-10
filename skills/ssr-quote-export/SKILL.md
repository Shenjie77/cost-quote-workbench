---
name: ssr-quote-export
description: 导出指定 SSR 项目的客户报价 Excel，或填入用户提供的公司报价模板，并核对报价历史；不修改成本、定价、条款或审批结果。
---

# SSR · 报价导出

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 cost-cli 是此前缀的简称。已知项目号直接读取该项目，未知才用 project list；不读取完整 workspace，也不先加载报价编制或模板维护 skill。

按需读取 `project get --project-id ID`、`cost get --project-id ID --section settings`、`quote get --project-id ID --section settings|assumptions`。需要核对条款时，只读取 selectedQuoteTemplateId 对应的 `quote get --project-id ID --section templates --id TEMPLATE-ID`。导出使用项目捕获的模板和该成本版本原始费率，不读取最新全局库来替换历史依据。

标准报价及公司模板填充都使用 activeVersion。用户指定其他版本时先核对，不能默认输出当前版本冒充指定版本。当前成本须为 Confirmed，并通过客户模板、成本及定价输入校验。统一 Project Workflow 不再要求重复维护本地 SSR 提交、依赖评审或批准条件；正式审批仍以公司平台为准。导出请求不授权把 Draft 自动改为 Confirmed、代作公司审批或改定价/条款；缺项时说明具体前置。导出也不自动完成流程；只有用户确认报价工作完成时，才由流程更新 skill 按实际计划完成配置为 finishesWorkflow 的结束节点，满足其关键信息要求后停止提醒。

标准客户报价：

```sh
cost-cli quote export --project-id ID --output outputs/Quote-new.xlsx
```

该命令不接受 `--version`、`--expected-revision` 或 `--compact`。报价编号由平台生成；成功导出同时记录报价历史。不要因导出重试而重写原记录。

用户提供公司 .xlsx 模板时，先 `workbook inspect --file Company.xlsx`，仅此时读取 [公司报价模板映射](references/template.md)。映射的 purpose 必须为 quote；mapping.version 是版式映射版本，不是成本版本。没有实际模板不能声称已套用公司版式。

输出中不得包含内部成本、RE 费率、毛利或成本标量。所选人员 Pool 的可选 3% 已包含在年度成本计算中，导出不再追加金额。原模板保留内容同样要核对是否适合客户查看。

使用新的输出文件名，未经用户要求不覆盖原文件或模板。成功回执返回 artifact 的 path/sha256/sizeBytes/mimeType 及工作表，不含历史 ID 或 revision。用 `quote get --project-id ID --section history` 按文件路径查询，再核对 SHA 和实际报价编号；必要时分页，不只检查第一条，因为标准导出与模板导出的历史插入位置不同。

项目报价导出自动归档生成文件，模板导出还保留输入模板；可用 `files list --project-id ID --category quote --version Vn` 核对文件。文件已生成但历史保存或归档失败必须报告为部分完成，不盲目重复导出。归档失败可用 `files upload` 补存已生成文件，参数按需查 [CLI 文档归档](../../docs/cli-control-manual.md#project-documents-and-archive-location)。历史记录仍为 Draft；导出或上传不表示已提交公司系统、完成审批、解锁成本或已发送客户。
