---
name: ssr-cost-export
description: 核验指定 SSR 成本版本并导出内部成本 Excel 或填入公司成本模板；不生成客户报价、不修改成本输入。
---

# SSR · 成本核验与导出

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

指定项目和成本版本，读取 `cost get --project-id ID --version V1 --section summary`，再运行：

```sh
cost-cli cost validate --project-id ID --version V1
cost-cli cost calculate --project-id ID --version V1
cost-cli cost export --project-id ID --version V1 --output outputs/Cost-new.xlsx
```

以领域计算结果为准，不在提示词重做金额计算。已锁定版本的汇总仍可查看、校验和导出，显式指定版本即可；同项目其他新版本可继续编制，不改变该锁版。所选人员 Pool 的 3% 若开启，年度 Cost 已包含，不再增加层级、字段或额外金额行。

公司原始模板：先 `workbook inspect --file Company.xlsx`，需要映射时才读取 [成本模板](references/template.md)。没有实际模板不能声称符合公司版式。不要为了导出成功修改成本或批准状态。

核对输出 manifest、路径与对账结果；源表和已存在文件保持不变，除非用户要求覆盖指定文件。报告校验失败/文件写入失败，不把失败当成功。内部成本文件可含成本、费率、毛利；客户报价由报价 skill 处理。

用户要求“简易导出/按页面导出”时，运行 `cost export --project-id ID --version Vn --format simple --output outputs/Cost-simple.xlsx`。文件包含 Cost Detail、Summary Scope、Summary BU、Summary RE Type、Cost Statement、Summary Subcon 六张业务表；按页面展示年度投入/成本和多维汇总，报表中英文放同一格，不输出后台类型、编码、ID、Source 列。报表科目号保留在 Report Item 内。默认省略 format 或 `--format full` 仍输出完整九页审计工作簿。两种格式都取该版本已计算结果，支持锁版只读导出，不更改成本。

项目导出自动归档生成文件，模板导出还保留输入模板；可用 `files list --project-id ID --category cost --version Vn` 核对文件。归档失败仍返回错误，即使输出文件已生成；按已完成状态用 `files upload` 补归档，不把错误当作完整成功。上传不完成节点或解锁成本，参数按需查 [CLI 文档归档](../../docs/cli-control-manual.md#project-documents-and-archive-location)。
