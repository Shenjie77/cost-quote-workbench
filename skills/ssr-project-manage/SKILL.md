---
name: ssr-project-manage
description: 新建 SSR 报价项目、修改基本资料、删除或恢复项目，维护归档位置及项目文档；流程进度和节点文档使用 ssr-workflow-update，成本版本使用 ssr-cost-create。
---

# SSR · 项目管理

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

新建项目必须有用户提供的项目号、名称、客户，使用 `cost-cli project create --input project.json`。这是仅创建命令，不带 expected-revision；已有或已删除的同号项目会拒绝，不能覆盖或自动恢复。

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "unique-id",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "project.create",
    "project": {
      "id": "USER-PROJECT-ID",
      "name": "用户项目名称",
      "client": "用户客户名称"
    }
  }
}
```

创建返回空白 V1 草稿，并捕获创建时的全局主数据为项目和成本版本的独立快照。以后维护全局库不会改动这个项目。使用实际成本前核实捕获的 RE 费率、有效期与 TD 日期，不把初始样例当成公司已批准记录。

创建时自动在已配置的归档根目录建立项目文件夹。用户指定归档目录时，用 `files settings` 读取独立配置 revision，再 `files settings --root /absolute/folder --expected-revision R`；这不是项目 revision，无需读取项目，正常项目操作不擅自更改全局目录。目录更新用于后续新建项目，已有项目保留原位置。

归档目录按 `workflow/cost/quotation` 三个模块组织。逻辑类别不变：`general/backup` 存入 workflow，`cost/source` 存入 cost，`quote/cpq/maintenance` 存入 quotation；`quotation` 不是 CLI category 值。节点文档按可读节点名称建子目录，轮次仍用元数据筛选，不根据文件夹推断版本。

已有项目改路径属于单项目迁移，不用修改全局根目录替代。项目编辑会复制并校验原目录后更新索引，不能直接在磁盘搬走已登记文件；操作及历史布局兼容见 [项目文件归档](../../docs/project-files.md)。

```sh
cost-cli files list --project-id ID
cost-cli files upload --project-id ID --category general --input /absolute/document.pdf --compact
cost-cli files download --project-id ID --file-id FILE_ID --output /absolute/download/document.pdf
```

`files list` 返回项目归档路径和文档元数据，不加载 workspace。上传直接接收文件路径，不套 JSON 信封；不改流程、成本或项目 revision。节点文档交由流程更新 skill，显式指定节点和轮次。应用成本/BOQ 导入后自动保存源文件，项目 Excel 导出自动保存生成文件；不需重复上传。若归档失败，按错误中已完成步骤恢复，不盲目重复导入。详细命令、分类和错误处理按需读 [CLI 文档归档](../../docs/cli-control-manual.md#project-documents-and-archive-location)。

修改名称/客户：`project get --project-id ID`，随后 `project update --project-id ID --input change.json --expected-revision R`，只设置 `name/client`。Proposal 编号、Scope、公司平台链接、技术资料版本和模式使用 `project get/update --section metadata`，set 字段为 proposalNumber/companyUrl/scopeBrief/technicalBasis/mode（service 或 tender）。流程进展先读 `project get --section workflow-plan`，再用 `project workflow-action`，交流程更新 skill；不独立设置 projectStatus 或修改历史 reviewGates。
`project apply-masterdata` 仅允许当前 activeVersion 为未锁定 Draft 的项目；指定成本版本费率则用 `cost apply-rates --version`。若当前版本已定稿，先按用户的新一轮估算意图建立新 Draft，保持原版与历史归档不变。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：

```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"project.update","changes":CHANGES}}
```

集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

用户明确要求已有项目采用更新后的全局参考库时，用 `project apply-masterdata --project-id ID --tab TAB --expected-revision R`。支持 subcontract/supplemental/maintenance/assumptions/quote-templates/cpq-catalog，先核对该全局页签和本项目捕获快照，使用项目最新 revision；默认项目资料修改不执行它。该操作不改已捕获成本费率或历史归档；resources 只能用指定版本的 cost apply-rates，workflow 模板采用 workflow preview/publish 同步允许更新的未完成项目，新成本 Draft 使用最新全局模板；status 仅兼容保留。应用新商业依据后需核对公司实际评审进展，在项目流程统一备注，不沿用旧版批准结论。

删除须有实际删除请求：`project delete --project-id ID --expected-revision R`。删除可恢复，并保留成本锁和归档。恢复先 `project list --deleted`，然后 `project restore --project-id ID --expected-revision R`，不能自动重建已删除项目。

捕获所需全局页签存在未解决来源冲突时，创建/应用会拒绝。报告页签和编码，由对应维护 skill 根据用户提供的完整正确条目解决；不要从任意旧项目挑值绕过。
