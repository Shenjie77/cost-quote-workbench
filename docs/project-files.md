# 项目文件与节点文档归档

## 页面入口

- 新建项目表单中的 **Project Archive Folder** 设置归档根目录，默认是数据库目录下的 `project-files`，通常为工作台的 `data/project-files`。修改后点击 **Save Folder**，再建立项目。
- **Project Workflow → Project Files & Archive** 显示该项目实际文件夹、全部归档文件及目录设置。此卡片的拖放区域用于项目公共文档。
- 在现有 **Steps** 列表选择流程节点，再将文件拖到该节点的 **Documents** 卡片；也可点击 **Drop files here** 区域选择文件，无需再次选择节点。卡片显示 `workflow / <节点名称>`，上传文件归属于所显示的项目、流程轮次和节点。
- 支持一次上传多个文件、查看上传队列、失败重试、刷新列表和下载。单个文件上限为 50 MiB。

新建项目成功时自动建立独立文件夹，页面和 CLI 使用同一逻辑。已有项目首次使用归档时建立文件夹。文件夹名包含项目 ID、名称和唯一标识；修改项目名称不会移动已有文件。

根目录设置只影响尚未建立归档目录的项目。已有项目继续使用原路径；需要修改某个项目的位置时，在项目编辑中单独修改其文件夹。路径由运行工作台服务的电脑解析，应填写该电脑可写的绝对路径。

## 编辑项目信息

在 **Project List → Action → Edit** 修改项目名称、客户、Proposal Number、iSales/CPQ 链接，或展开 **Scope & Technical Basis** 维护描述。点击 **Save Project Info** 保存，同一项目的 Cost 与 Workflow 使用更新后的资料；已有成本版本、DRB 记录及历史报价快照保留。

**Project Folder** 显示当前项目的完整文件夹路径。输入新的独立路径，点击 **Apply Folder** 迁移已有归档；它独立于项目信息保存，也不更改其他项目或新项目的默认根目录。未应用的路径修改需要先 Apply 或 Reset，才能保存项目信息。修改项目名称不会自行重命名文件夹。

支持直接粘贴带外层引号的完整路径、`file:///...` 本地文件 URL、`~/...` 主目录路径，以及 macOS Terminal 中带空格转义的路径。服务器会先解析这些输入格式，再检查目标目录。Windows 盘符和 UNC 路径只能由 Windows 服务使用；macOS 上的网络共享应先挂载，再填写 `/Volumes/...` 等本机路径，不能直接填写 `smb://...`。目标应包含新的项目文件夹名，且该文件夹尚不存在。

在原生 Windows 服务中，`D:\QuotePlatform\Test Project` 是有效目标格式，空格及反斜杠会保留。盘符或共享根不可访问时会明确提示目标不可用，父目录查找不会停留在根目录无限重试。若服务运行在 WSL 或容器中，应填写该服务可访问的挂载路径，不能仅按浏览器所在系统判断。

Windows 迁移会刷新写入的文件并校验内容，但跳过 POSIX 只读目录句柄的刷新；旧布局迁移仅以可写句柄刷新新副本，不刷新只读源文件。该差异源于 Windows 的 [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers) 需要可写句柄。内容验证失败或文件刷新失败时保留原件。

## 文件组织

```text
<归档根目录>/<项目 ID>--<项目名称>--<唯一标识>/
  workflow/                        项目公共文件、JSON 备份
    <节点名称>/                     该节点上传文档
  cost/                            成本 Excel、导入原件及模板原件
  quotation/                       客户报价、CPQ 配置、维保报价 Excel
```

目录只按 `workflow`、`cost`、`quotation` 三个业务模块组织；节点文件夹使用可读名称，流程轮次不另建一层目录。轮次和节点代码仍保存在文档元数据中，页面及 CLI 继续按节点、版本筛选，不能从磁盘位置推断轮次。

节点名称中的空格会保留，不适合路径的标点会替换为分隔符。目录采用当前节点名称；文档仍保留上传时的节点名称、代码及轮次记录。旧布局中的已登记文件通过复制、校验和索引更新迁入新布局；旧类别目录中未登记的普通文件也保留到对应模块，遇到不安全路径或符号链接则保留原件。

逻辑类别保留兼容：`cost/source` 存入 `cost`，`quote/cpq/maintenance` 存入 `quotation`，`general/backup` 存入 `workflow` 根目录，节点文档存入 `workflow/<节点名称>`。CLI 的 `--category` 参数仍使用这些原有类别，不使用 `quotation` 作为类别值。

磁盘文件名带唯一标识，列表和下载保留原文件名。同名上传分别保留，不覆盖历史文件；上传失败可以重试。同一上传请求重试不会重复入库。SQLite 保存项目归属、逻辑类别、版本、节点、时间、大小、校验值和相对路径，文件内容保存在文件夹中。

节点完成、项目挂起或成本锁定后，仍可补充及读取文档。上传文档不会完成节点、改变提醒状态或解锁成本。新成本版本开启新流程轮次，旧轮次文档保留；退役节点的附件仍可在项目归档列表中查到。删除项目保留归档以便恢复。

## 自动归档范围

工作台页面和项目范围的 CLI 操作会归档成本、报价、CPQ、维保导出的 Excel，以及应用导入时的成本/BOQ 原文件；CLI 填表时也保存模板原件。导出归档的是同一份实际输出文件，不重新计算一份副本。全局 Master Data 和未指定项目的独立文件操作不归属某个项目。

页面常规导出先归档，再下载；归档失败时显示错误。用于恢复的项目 JSON 备份会优先下载，离线时仍可取得备份，并提示归档未完成。CLI 若已生成文件或应用导入但随后归档失败，会返回 `PROJECT_FILE_ARCHIVE_FAILED` 并说明补录方式。

归档不监视任意本地文件夹，也不会自动收集公司平台附件。其他项目文件需要通过上传入口或 `files upload` 登记。

## CLI 与 Skill

以下 `cost-cli` 指仓库根目录的 `npm run --silent cost-cli --`：

```sh
cost-cli files settings
cost-cli files settings --root /absolute/archive-root --expected-revision 1
cost-cli files list --project-id ID
cost-cli files list --project-id ID --node-code CODE --version V1
cost-cli files upload --project-id ID --input /absolute/document.xlsx --node-code CODE --version V1 --request-id upload-001
cost-cli files download --project-id ID --file-id FILE_ID --output /absolute/document.xlsx
```

`files settings` 使用独立配置 revision，不需要项目 ID；文件查询和上传使用窄入口，不返回整个 workspace。节点代码及轮次应来自项目流程计划，不能根据显示名称猜测。未指定节点时上传为项目公共文件；节点附件应明确指定轮次。

项目目录设置和公共文件使用 `ssr-project-manage`；节点文档使用 `ssr-workflow-update`。成本和报价导出 Skill 已说明自动归档与失败恢复。完整参数见 [CLI 手册](cli-control-manual.md)。

## 备份与搬迁

完整恢复需要同时保留 SQLite 数据库和各项目实际归档文件夹。`backup:local` 备份数据库及文件索引，不复制文档内容；项目 JSON 也不包含附件。自定义根目录可能位于 `data` 之外，应按项目归档路径一并备份。恢复后应保留原路径；直接移动或删除目录会使已有索引无法读取文件。

通过项目编辑更换文件夹时，系统先复制并校验整棵项目目录，包括未登记文件，再提交归档路径更新。目标必须是新的独立目录，不能覆盖已有目录或与原目录嵌套。原目录只有在索引更新成功且内容未发生变化时才清理；复制期间有人修改文件时保留原目录，避免丢失改动。
