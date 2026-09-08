---
name: ssr-cost-export
description: 核验指定 SSR 成本版本并导出内部成本 Excel 或填入公司成本模板；不生成客户报价、不修改成本输入。
---

# SSR · 成本核验与导出

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

指定项目和成本版本，读取 `cost get --project-id ID --version V1 --section summary`，再运行：
```sh
cost-cli cost validate --project-id ID --version V1
cost-cli cost calculate --project-id ID --version V1
cost-cli cost export --project-id ID --version V1 --output outputs/Cost-new.xlsx
```
以领域计算结果为准，不在提示词重做金额计算。已锁定版本的汇总仍可查看、校验和导出，显式指定版本即可；同项目其他新版本可继续编制，不改变该锁版。Local/ARP 3% 若开启，年度 Cost 已包含，不再增加层级、字段或额外金额行。

公司原始模板：先 `workbook inspect --file Company.xlsx`，需要映射时才读取 [成本模板](references/template.md)。没有实际模板不能声称符合公司版式。不要为了导出成功修改成本或批准状态。

核对输出 manifest、路径与对账结果；源表和已存在文件保持不变，除非用户要求覆盖指定文件。报告校验失败/文件写入失败，不把失败当成功。内部成本文件可含成本、费率、毛利；客户报价由报价 skill 处理。
