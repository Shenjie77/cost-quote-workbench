# SSR · 导出成本

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

项目和成本版本已明确时直接导出，命令会校验输入；仅在校验失败需要定位时读取 summary 或运行 cost validate：

```sh
cost-cli cost export --project-id ID --version V1 --output outputs/Cost-new.xlsx
```

以领域计算结果为准，不在提示词重做金额计算。已锁定版本的汇总仍可查看、校验和导出，显式指定版本即可；同项目其他新版本可继续编制，不改变该锁版。所选人员 Pool 的 3% 若开启，年度 Cost 已包含，不再增加层级、字段或额外金额行。

公司原始模板：先 `workbook inspect --file Company.xlsx`，需要映射时才读取 [成本模板](../references/template.md)。没有实际模板不能声称符合公司版式。不要为了导出成功修改成本或批准状态。

核对输出 manifest、路径与对账结果；源表和已存在文件保持不变，除非用户要求覆盖指定文件。报告校验失败/文件写入失败，不把失败当成功。内部成本文件可含成本、费率、毛利；客户报价由报价 skill 处理。

用户要求“简易导出/按页面导出”时，运行 `cost export --project-id ID --version Vn --format simple --output outputs/Cost-simple.xlsx`。工作表含人员明细及 Scope/BU/RE Type/Group/分包汇总等，数量随数据及配置变化；HQ 差旅使用共享计算结果。CLI 不继承浏览器视图/工作表勾选。省略 format 或 `--format full` 输出完整审计工作簿。两种格式都取该版本已计算结果，支持锁版只读导出，不更改成本。

项目导出自动归档生成文件，模板导出还保留输入模板；可用 `files list --project-id ID --category cost --version Vn` 核对文件。归档失败仍返回错误，即使输出文件已生成；按已完成状态用 `files upload` 补归档，不把错误当作完整成功。上传不完成节点或解锁成本，参数按需查 [CLI 文档归档](../../../docs/cli-control-manual.md#project-documents-and-archive-location)。

Simple / Full 及 Quotation + Simple Cost 导出保留 Excel 公式和缓存结果。人员数量、分包数量与单价连接明细和汇总；Simple 的隐藏 Cost Calculations 表处理 HQ 差旅分摊。Summary Group 按 Category 分段，含 Group 明细、有分类分包及分类小计；未分类人员和项目公共费用单列，总计仅汇总各段小计。空 Category 不根据 Group 猜测。省略明细或年度时保留该部分已捕获输入；Excel 修改不回写平台，新增来源行、变更分组或需要新版公式和布局时重新导出。详见 [导出公式](../../../docs/excel-export.md)。
