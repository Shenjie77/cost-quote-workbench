# 成本设置、人员补贴及差旅

`--section settings` 使用 set，字段：`rateSettings/travelSettings/travelUplift/manualCosts/state`。先设置 TD 开始日期；Y1 从该年份起算。3% 用 `rateSettings.allowancePools:["LOCAL","ARP"]` 选择人员 Pool；LOCAL/ARP/HQ/OTHER 均可选择，适用于本版资源快照中归属该 Pool 的所有 internal 人员。数组整体替换：增加/移除某 Pool 前先保留当前其他选择，`[]` 明确关闭。所选 Pool 的人员每年 Cost 已含 3%，Summary/历史/报价/Excel 直接汇总；不要增加 allowance 行或修改主数据费率、人天。关闭后从原始投入与费率重算。分包、差旅和手工费用不套该 3%。

HQ 差旅需要 `travelSettings.enabled:true`，按本版 internal/HQ 的人天折算人月，再计月补贴与手工录入的往返机票；`false` 时补贴和机票成本均为 0，保留已录入参数。不因发现 HQ 人力而自动启用。新空白成本默认 allowancePools 为 []、HQ Travel 为 false；历史版本缺少 Pool 字段时保留原有 `allowanceResourceTypeIds` 精确选择，若 ID 字段也缺少则沿用 `localArpAllowanceEnabled`。克隆保留源版设置，不主动补写或改变历史金额。新操作使用 Pool 数组；旧版部分 RE Type 的选择不能仅因查看页面而扩展到整个 Pool，用户主动更改 Pool 后才按所选类别整体计算。

`--section travel` 是额外差旅明细；HQ 差旅使用上述显式开关与 HQ 人天计算。避免同一分包/费用重复入账。更新主数据 RE 费率不会重算成本；用户明确要求且指定目标版本未锁定时，才用 `cost apply-rates --project-id ID --version V1 --expected-revision R`；它显式从最新全局 resources 捕获费率，只更新该版本的费率快照和计算金额，旧锁版保持不变。

Cost Statement 2.3.1 继续自动汇总自有人力、非自有人力和 HQ 差旅。2.3.4.2 新空白成本默认按 2.3.1 人力及差旅 + 2.3.2 分包 + 2.3.3 结算成本的 1% 计算，对应 `manualCosts.otherServiceRate:0.01`。仅设置 `{"set":{"manualCosts":{"otherService":123.45}}}` 会切换为手动金额；设置 `{"set":{"manualCosts":{"otherServiceRate":0.01}}}` 恢复自动。比例是 0–1 小数；不能把 1 写成 1%。旧版本未保存比例字段时沿用原手工金额，克隆保持原模式，不主动改历史金额。
