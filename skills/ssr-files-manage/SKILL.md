---
name: ssr-files-manage
description: 查询、上传、下载 SSR 项目或流程节点的归档文件，设置全局归档根目录；不推进业务状态。
---

# SSR · 管理归档文件

在仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`，下文简称 `cost-cli`。已知项目 ID 直接：

```sh
cost-cli files list --project-id ID
cost-cli files upload --project-id ID --category general --input /absolute/document.pdf --compact
cost-cli files download --project-id ID --file-id FILE_ID --output /absolute/download/document.pdf
```

名称不明确 ID 时先 project list；上传接收文件路径，不套 JSON 信封。下载使用实际返回的 file ID，不猜路径。核对文件名、sha256、类别、节点及版本；未经要求不覆盖已有文件。

只有节点附件需先 `project get --project-id ID --section workflow-plan`，用实际 nodeCode/workflowVersion。上传和列表加 `--node-code CODE --version Vn`；历史轮次按用户指定版本。附件不改变项目 revision、不完成节点或代表批准。

归档目录为 workflow/cost/quotation；CLI category 使用 general/backup/workflow、cost/source、quote/cpq/maintenance 等逻辑值，`quotation` 不是 category。节点目录名称不能当 nodeCode。导入/导出已自动归档时不重复上传；部分失败按已完成步骤补传保留的文件，不重做导入。

仅设置全局根目录时先 `files settings`，再 `files settings --root /absolute/folder --expected-revision R`，使用文件配置 revision；只影响新项目。CLI 没有单项目迁移、打开文件夹或删除归档命令；此类操作说明界面入口，不直接搬磁盘文件。

普通文件操作不加载其他 skill；只有文件约束或失败恢复不明确时读 [归档契约](../../docs/cli-control-manual.md#project-documents-and-archive-location)。
