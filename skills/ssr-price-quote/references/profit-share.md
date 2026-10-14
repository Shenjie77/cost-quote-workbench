# 项目分成快照与定价

Profit Share Rate 按项目捕获的 `pricing.profitShareRates` 计算，比例为百分数（20 表示 20%）。平台按最终成本中各 BU 占比分摊未税报价；EHS、Risk 等无 BU 成本归入直接成本最大的 BU。Sales GP = (未税报价 − 成本 − 分成金额) / 未税报价；目标折扣前价格 = 总成本 / (1 − 目标 GP − 加权分成率)，之后的折扣仍会降低实际 GP。目标 GP 与加权分成率之和必须小于 100%；无匹配比例的 BU 会明确显示按 0% 计算，不能猜测实际比例。

全局比例维护单独使用 [BU 分成维护](../../ssr-maintain-profit-share/SKILL.md)，无需项目。只有用户要求应用最新比例时，读取目标报价设置与项目 revision 后执行 `project apply-masterdata --project-id ID --tab profit-share --expected-revision R`，再读回报价设置。新项目自动捕获，旧项目不自动采用，历史报价保存各 BU 分成快照。
