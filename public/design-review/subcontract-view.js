import { pick } from './i18n.js';
import { esc, input, btn, table, heading, cellInput } from './ui.js';
import { engine } from './business/adapter.js';
import { ratesView } from './rates-view.js';
const money = (n) => (n == null ? '—' : Number(n).toFixed(2));
export function subcontractView(
  state,
  data,
  selected = 'shared',
  catalogOpen = false,
) {
  const cost = data.snapshot.subcontractCost;
  const result = engine.calculateSubcontractCost(
    cost,
    engine.getY1Year(state.rateSettings),
  );
  const site = state.siteTypes?.find((s) => s.id === selected);
  const lines = site?.lines || state.subcon;
  const years = engine.getActualYears(state.rateSettings);
  const collection = site ? 'siteLines' : 'subcon';
  const calculated = site
    ? result.siteTypes.find((s) => s.id === site.id)
    : null;
  const tabs = [
    ['overview', pick('年度总览', 'Annual overview')],
    ['shared', pick('共享 / 一次性', 'Shared / One-off')],
    ...(state.siteTypes || []).map((s) => [s.id, s.name]),
  ];
  const heads = [
    { label: 'Code', cls: 'c-code' },
    { label: pick('描述', 'Description'), cls: 'c-description' },
    { label: 'Category', cls: 'c-medium' },
    { label: 'BU', cls: 'c-short' },
    { label: pick('单位', 'Unit'), cls: 'c-short' },
    { label: pick('基准单价', 'Base unit price'), cls: 'c-number' },
    ...(site
      ? [{ label: pick('每站数量', 'Qty / site'), cls: 'c-number' }]
      : years.map((y, i) => ({
          label: `Y${i + 1} · ${y || '—'}`,
          cls: 'c-short',
        }))),
    { label: pick('总成本', 'Total cost'), cls: 'c-number' },
    { label: pick('操作', 'Actions'), cls: 'c-action' },
  ];
  const detail = table(
    heads,
    lines
      .map((r) => {
        const id = site ? `${site.id}:${r.id}` : r.id;
        const quantity = site
          ? cellInput(
              collection,
              id,
              'quantityPerSite',
              r.quantityPerSite,
              'number',
            )
          : (r.quantities || [r.qty, 0, 0, 0, 0])
              .map((q, i) => cellInput(collection, id, `qty${i}`, q, 'number'))
              .join('');
        const amount =
          (calculated?.lines || result.lines).find((l) => l.id === r.id)
            ?.total || 0;
        return `<tr><td data-user-content>${esc(r.code)}</td>${cellInput(collection, id, 'description', r.description)}${cellInput(collection, id, 'category', r.category || '', 'text', 'list="category-options"')}${cellInput(collection, id, 'bu', r.bu)}${cellInput(collection, id, 'unit', r.unit)}${cellInput(collection, id, site ? 'unitPrice' : 'price', site ? r.unitPrice : r.price, 'number')}${quantity}<td class="num">${money(amount)}</td><td>${btn(pick('移除', 'Remove'), 'delete-subcon', false, '', `data-id="${esc(r.id)}" data-site="${esc(site?.id || '')}"`)}</td></tr>`;
      })
      .join(''),
  );
  const overview = table(
    [
      { label: pick('成本来源', 'Cost source'), cls: 'c-description' },
      ...years.map((y, i) => ({
        label: `Y${i + 1} · ${y || '—'}`,
        cls: 'c-number',
      })),
      { label: pick('合计', 'Total'), cls: 'c-number' },
    ],
    [
      {
        name: pick('共享 / 一次性', 'Shared / One-off'),
        years: years.map((_, i) =>
          result.lines.reduce((n, l) => n + l.years[i], 0),
        ),
        total: result.lines.reduce((n, l) => n + l.total, 0),
      },
      ...result.siteTypes,
    ]
      .map(
        (s) =>
          `<tr><td data-user-content>${esc(s.name)}</td>${s.years.map((n) => `<td class="num">${money(n)}</td>`).join('')}<td class="num">${money(s.total)}</td></tr>`,
      )
      .join('') +
      `<tr class="total-row"><td>${pick('分包合计', 'Subcontract total')}</td>${result.years.map((n) => `<td class="num">${money(n)}</td>`).join('')}<td class="num">${money(result.total)}</td></tr>`,
  );
  return (
    heading(
      pick('分包成本', 'Subcontract costs'),
      pick(
        '共享费用与站型配置分别维护，单价和数量直接编辑。',
        'Edit shared costs and site configurations inline.',
      ),
      btn(pick('添加站型', 'Add site type'), 'add-site', false, 'plus'),
    ) +
    ratesView(state, true) +
    `<section class="sheet"><div class="toolbar"><div class="segments">${tabs.map(([id, label]) => `<button class="segment" data-action="subcon-tab" data-value="${esc(id)}" aria-pressed="${selected === id}">${esc(label)}</button>`).join('')}</div><span class="grow"></span>${selected !== 'overview' ? btn(pick('从目录添加', 'Add from catalog'), 'subcon-catalog', false, 'plus') : ''}${site ? btn(pick('复制配置（站数清零）', 'Copy configuration (zero sites)'), 'copy-site', false, '', `data-id="${site.id}"`) + btn(pick('移除站型', 'Remove site type'), 'delete-site', false, '', `data-id="${site.id}"`) : ''}</div>${site ? `<div class="toolbar"><label class="inline-field"><span>${pick('站型名称', 'Site type')}</span>${input('sites', site.id, 'name', site.name)}</label>${site.sites.map((v, i) => `<label class="inline-field small-field"><span>Y${i + 1} ${pick('站数', 'sites')}</span>${input('sites', site.id, `sites${i}`, v, 'number')}</label>`).join('')}</div>` : ''}${catalogOpen && selected !== 'overview' ? `<div class="details-content"><h3>${pick('项目已采用的分包目录', 'Adopted subcontract catalog')}</h3>${table(['Code', pick('描述', 'Description'), pick('参考单价', 'Reference price'), pick('操作', 'Action')], state.subconCatalog.map((r) => `<tr><td>${esc(r.code)}</td><td data-user-content>${esc(r.description)}</td><td class="num">${money(r.price)}</td><td>${btn(pick('添加', 'Add'), 'catalog-add', false, '', `data-id="${r.id}" ${lines.some((l) => l.code === r.code) ? 'disabled' : ''}`)}</td></tr>`).join(''))}</div>` : ''}${selected === 'overview' ? overview : detail}<div class="sheet-footer">${pick('金额采用原平台年度系数与逐行舍入；进入成本科目 2.3.2。', 'Original annual factors and per-line rounding; included in account 2.3.2.')}<span class="grow"></span><strong>SGD ${money(result.total)}</strong></div></section>`
  );
}
