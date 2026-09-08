# 结构化分包成本

在主 skill 指定的仓库根目录使用 cost-cli 前缀。按目标版本检查 settings 的锁状态，再只读取需要的分包数据：

```sh
cost-cli cost get --project-id ID --version Vn --section subcontract
cost-cli cost update --project-id ID --version Vn --section subcontract --input change.json --expected-revision R
```

写入使用主 skill 的 `cost.update` 信封，`changes` 为 `{"set":{...}}`。对象字段是 `mode`、`lines`、`siteTypes`；数组整项替换，只读本分包对象并保留未涉及的条目，不读取全部 workspace。

- `mode:"project"`：小项目直接按各条目年度实际数量计费。`lines` 的每行包含 `id/code/description/bu/unit/unitPrice/currency/quantities`；`quantities` 为 Y1–Y5 顺序的 5 个数。`catalogItemId` 是可选来源引用。
- `mode:"site-types"`：大项目 `siteTypes` 每组包含 `id/name/sites/lines`；`sites` 为 5 年站点数量，组内条目把 `quantities` 换成 `quantityPerSite`。先算站型单站 BOQ，再乘各年站点数。顶层 `lines` 仍计入，专门放一次性或项目共有费用，不能同时复制站型费用。
- 如需新目录条目，窄读 `masterdata get --tab subcontract --id ID` 或 `--query TEXT`，经用户选择后复制 `item→description`、code、bu、unit、unitPrice 和 currency。不能只存目录 ID 后动态取最新价格。缺失单价保持 null，不能补 0；显式 0 为真实零成本。没有目录参考时按用户给出的实际范围、单位和价格建立项目条目。
- 当前入账币种为 SGD。其他币种不能直接当作 SGD；需要用户提供实际采用的 SGD 单价。pcs 与站点数量为非负整数，其他单位可为小数。Y1 对应目标版本 TD 开始年份。
- 旧的 RE 分包行仅保留历史金额。用户要求替换时先准备结构化明细与年度金额对照，明确移除被替代的旧行；不能把旧行留着再额外叠加同一费用。只移除指定行，不清除历史版本。
- 全局目录维护不改变任何旧版本。仅在用户要求重新取价时读取指定目录并修改选中的 Draft 明细；旧价格、已锁版本和其他项目保持不变。成本指纹包括完整 BOQ，数量、单价或站型变化均使原确认依据失效。

示例：router 安装 200 SGD/pcs、patch cord 供应安装 80 SGD/pcs，A 型每站分别为 1 和 2，单站成本为 360 SGD。Y1 为 100 站时计入 36,000 SGD。示例数量不能直接写入真实项目。

更新后窄读本版 `summary`，核对 `subcontract` 与各年汇总，并运行 `cost validate`。价格缺失或年份未确定时可保留 Draft，但不能确认成本或导出正式成本文件。
