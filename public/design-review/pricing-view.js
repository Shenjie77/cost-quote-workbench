import { esc, btn, badge, cellInput, table, heading } from './ui.js';
import { pick } from './i18n.js';
const money = (n) =>
  Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function pricingView(state, data, pricing, preview) {
  const errors = pricing.errors.length
    ? `<div class="validation" role="alert">${pick('报价暂不可交付，请修正：', 'Quotation output blocked. Correct the following:')}<ul>${pricing.errors.map((e) => `<li>${esc(pick(e.split(' / ')[1] || e, e.split(' / ')[0]))}</li>`).join('')}</ul></div>`
    : '<div class="validation" role="alert" hidden></div>';
  if (preview && pricing.valid)
    return (
      heading(
        pick('客户报价预览', 'Customer quotation preview'),
        pick(
          '分类金额和折扣描述直接取自报价明细。',
          'Category amounts and discount descriptions come from the quotation lines.',
        ),
        btn(pick('返回编辑', 'Back to edit'), 'preview') +
          btn(
            pick('导出示例 CSV', 'Export sample CSV'),
            'export',
            true,
            'download',
          ),
      ) +
      `<section class="sheet"><div class="table-scroll"><article class="quote-paper"><div class="page-heading"><h2>${pick('服务报价', 'Service quotation')}</h2>${badge(pick('示例 · 草稿', 'Sample · Draft'), 'warning')}</div>${table(
        [
          {
            label: pick(
              'Section / Category / 描述',
              'Section / Category / Description',
            ),
            cls: 'c-description',
          },
          { label: 'SGD', cls: 'c-medium' },
        ],
        pricing.rows
          .map(
            (r) =>
              `<tr class="statement-subtotal"><td>${r.inclusion === 'optional' ? 'Optional' : 'Mandatory'} / ${esc(r.label)}</td><td class="num">${money(r.price)}</td></tr><tr><td data-user-content>${esc(r.description || pick('折扣', 'Discount'))}</td><td class="num">− ${money(r.discount)}</td></tr><tr class="total-row"><td>${pick('分类小计', 'Category subtotal')}</td><td class="num">${money(r.net)}</td></tr>`,
          )
          .join('') +
          `<tr class="statement-grand"><td>${pick('最终报价（含所有 Section）', 'Grand total (all sections)')}</td><td class="num">${money(pricing.quoteAfterTax)}</td></tr>`,
        '',
      )}<p>${pick('报价有效期：30 天。此处不另计 GST；正式条款以所选客户模板为准。', 'Valid for 30 days. No GST is added; formal terms follow the selected customer template.')}</p></article></div></section>`
    );
  const headers = [
    { label: 'Section', cls: 'c-code' },
    { label: 'Category', cls: 'c-code' },
    { label: pick('成本 / SGD', 'Cost / SGD'), cls: 'c-number' },
    { label: pick('行 GP %', 'Line GP %'), cls: 'c-short' },
    { label: pick('折前报价', 'List price'), cls: 'c-number' },
    { label: pick('折扣占比 %', 'Discount %'), cls: 'c-number' },
    { label: pick('折扣金额', 'Discount'), cls: 'c-number' },
    { label: pick('折后报价', 'Net price'), cls: 'c-number' },
    {
      label: pick('分类折扣描述', 'Category discount description'),
      cls: 'c-note',
    },
  ];
  const rows = pricing.rows
    .map(
      (r) =>
        `<tr><td class="edit"><select data-collection="sections" data-id="${esc(r.category)}" data-field="section" aria-label="Section ${esc(r.category)}"><option value="mandatory" ${r.inclusion === 'mandatory' ? 'selected' : ''}>Mandatory</option><option value="optional" ${r.inclusion === 'optional' ? 'selected' : ''}>Optional</option></select></td><td>${esc(r.label)}</td><td class="num">${money(r.total)}</td>${cellInput('lineGp', r.category, 'gp', state.lineGp[r.category] ?? state.gp, 'number', state.quoteMode === 'line-gp' ? '' : 'disabled')}${cellInput('prices', r.category, 'price', r.price, 'number', state.quoteMode === 'manual' ? '' : 'disabled')}${cellInput('discountShares', r.category || 'Uncategorized', 'percentage', state.discountShares[r.category || 'Uncategorized'] ?? '', 'number', `placeholder="${r.percentage.toFixed(2)}" title="${pick('留空按价格分配剩余比例', 'Blank shares allocate the remainder by price')}"`)}<td class="num">${money(r.discount)}</td><td class="num">${money(r.net)}</td>${cellInput('descriptions', r.category, 'text', state.descriptions[r.category] || '', 'text', `placeholder="${pick('使用模板描述', 'Use template wording')}"`)}</tr>`,
    )
    .join('');
  return (
    heading(
      pick('定价与报价', 'Pricing & quotation'),
      pick(
        '成本、BU 分成、折扣与实际毛利沿用同一计算规则。',
        'Cost, BU share, discounts and actual margin use the existing calculation rules.',
      ),
      btn(
        pick('客户预览', 'Customer preview'),
        'preview',
        true,
        '',
        pricing.valid ? '' : 'disabled',
      ),
    ) +
    errors +
    `<section class="sheet"><div class="toolbar"><label class="inline-field"><span>${pick('定价方式', 'Pricing basis')}</span><select data-setting="quoteMode" aria-label="${pick('定价方式', 'Pricing basis')}">${[
      ['gp', '整体 GP', 'Project GP'],
      ['line-gp', '独立行 GP', 'Independent line GP'],
      ['manual', '手动价格', 'Manual prices'],
    ]
      .map(
        ([id, zh, en]) =>
          `<option value="${id}" ${state.quoteMode === id ? 'selected' : ''}>${pick(zh, en)}</option>`,
      )
      .join(
        '',
      )}</select></label><label class="inline-field small-field"><span>${pick('目标 GP %', 'Target GP %')}</span><input data-setting="gp" type="number" min="0" max="95" aria-label="${pick('目标 GP', 'Target GP')}" value="${state.gp}" ${state.quoteMode === 'gp' ? '' : 'disabled'}></label><span class="small">${pick('BU 加权分成', 'Weighted BU share')} <strong>${pricing.weightedProfitShareRate.toFixed(2)}%</strong></span><label class="inline-field small-field"><span>${pick('折扣总额', 'Total discount')}</span><input data-setting="discount" type="number" min="0" aria-label="${pick('折扣总额', 'Total discount')}" value="${state.discount}"></label>${btn(pick('重置折扣比例', 'Reset discount shares'), 'reset-discount')}</div>${table(headers, rows, 'pricing-table')}<div class="sheet-footer"><span>${pick('成本', 'Cost')} <strong>${money(data.total)}</strong></span><span>${pick('BU 分成金额', 'BU share amount')} <strong>${money(pricing.profitShareAmount)}</strong></span><span>${pick('实际 GP', 'Actual GP')} <strong>${pricing.grossMarginPercent.toFixed(2)}%</strong></span><span class="grow"></span><span>${pick('最终报价', 'Final quotation')} <strong>SGD ${money(pricing.quoteAfterTax)}</strong></span></div></section><details class="panel details-panel"><summary>${pick('BU 分成依据与报价规则', 'BU share basis and pricing rules')}</summary><div class="details-content"><p>${pick('无 BU 的项目科目归入直接成本最大的 BU；分成按折后收入计算。成本汇总中的 BU 视图仍保留独立项目科目。', 'Unassigned project accounts are attributed to the largest direct-cost BU for pricing. Profit share uses discounted revenue. The BU cost report keeps project accounts separate.')}</p>${table([{ label: 'BU' }, { label: pick('分成成本基数', 'Cost basis') }, { label: pick('项目科目归入', 'Project accounts assigned') }, { label: pick('分成率 %', 'Share rate %') }, { label: pick('分成金额', 'Share amount') }], pricing.profitShareBreakdown.map((r) => `<tr><td>${esc(r.bu)}</td><td class="num">${money(r.cost)}</td><td class="num">${money(r.unassignedCost)}</td><td class="num">${r.ratePercent}</td><td class="num">${money(r.profitShareAmount)}</td></tr>`).join(''))}<p>${pick('GP 定价：成本 ÷（1 − 目标 GP − BU 加权分成），按原规则处理金额精度。所有 Section 计入总报价；分类不自动改变 Section。', 'GP pricing: cost ÷ (1 − target GP − weighted BU share), using existing monetary rounding. All sections count toward the grand total; Category does not automatically change Section.')}</p></div></details>`
  );
}
