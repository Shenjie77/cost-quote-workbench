# 成本定稿与暂停版本清理

定稿前窄读本版 settings/summary 并完成成本校验，向用户呈现可核对的版本和计算总成本。仅在用户明确确认本版定稿后，用 `cost update --project-id ID --version Vn --section settings` 提交 `{"set":{"state":"Confirmed"}}`；若用户已明确授权该版定稿，无需重复询问。普通成本更新、导入或“进入 DRB”不能当成定稿授权。Confirmed 只定稿成本，不代作 DRB approved；配置 requiresConfirmedCost 的节点（默认包括 DRB）要求该版成本先确认；公司进展通过统一流程记录，不再另建 SSR 审批单。

用户要求删除暂停的垃圾版本时，先窄读 `cost get --project-id ID --section versions`，确认指定版本为 Suspended、未锁定且项目至少还有一个其他版本，再运行 `cost delete --project-id ID --version Vn --expected-revision R`。不要通过 workspace.save 删除条目或清理评审证据。操作从工作列表移除版本、保留不可变历史快照，版本号不复用。可用 `cost get --project-id ID --section deleted-versions` 查看已删除目录，或 `--section archive --version Vn` 只读追溯完整快照。
