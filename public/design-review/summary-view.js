import { engine } from './business/adapter.js';
import { esc, btn, table, heading, cellInput } from './ui.js';
import { pick, language } from './i18n.js';
const money = (n) =>
  Number(n || 0).toLocaleString('en-SG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const label = (row) => (language === 'en' ? row.en : row.zh);
const amount = (n, cls = '') => `<td class="num ${cls}">${money(n)}</td>`;
const tabNames = [
  ['statement', '成本报表', 'Cost statement'],
  ['category', '按 Category', 'By Category'],
  ['group', '按 Group', 'By Group'],
  ['bu', '按 BU', 'By BU'],
  ['resource', '按资源', 'By resource'],
  ['subcontract', '分包明细', 'Subcontract detail'],
];
const names = {
  personnel: ['人力成本', 'HR Cost'],
  travel: ['差旅', 'Travel'],
  subcontract: ['分包', 'Subcontract'],
  ehs: ['EHS', 'EHS'],
  risk: ['风险', 'Risk'],
  other: ['其他', 'Other'],
  total: ['总成本', 'Total'],
};
const measures = [
  'personnel',
  'travel',
  'subcontract',
  'ehs',
  'risk',
  'other',
  'total',
];
export function summaryView(state, data, view) {
  const toolbar = `<div class="toolbar"><div class="segments" aria-label="${pick('汇总维度', 'Summary dimension')}">${tabNames.map(([id, zh, en]) => `<button class="segment" data-action="summary-tab" data-value="${id}" aria-pressed="${view === id}">${pick(zh, en)}</button>`).join('')}</div><span class="toolbar-note">${pick('币种 SGD · 全部年度', 'SGD · All years')}</span></div>`;
  let content;
  if (view === 'statement') {
    const heads = [
      { label: pick('报表项', 'Report item'), cls: 'c-statement-item' },
      {
        label: pick('来源 / 操作', 'Source / action'),
        cls: 'c-statement-source',
      },
      { label: pick('总成本 / SGD', 'Cost / SGD'), cls: 'c-medium' },
      ...data.sections.map((s) => ({
        label: `${esc(s.category || pick('未分类', 'Uncategorized'))} / SGD`,
        cls: 'c-medium',
      })),
    ];
    const body = data.statement
      .map((row) => {
        const source =
          language === 'en'
            ? row.source.split(' / ')[0]
            : row.source.split(' / ')[1] || row.source;
        let actions = '';
        if (row.code === '2.3.4.2')
          actions = btn(pick('按 1% 重置', 'Reset to 1%'), 'reset-ehs');
        if (row.code === '15')
          actions = btn(pick('按比例重置', 'Reset proportions'), 'reset-risk');
        const classes =
          row.mode === 'grand-total'
            ? 'statement-grand'
            : row.mode === 'section'
              ? 'statement-section'
              : ['subtotal'].includes(row.mode) ||
                  ['2.3.2', '2.3.3'].includes(row.code)
                ? 'statement-subtotal'
                : row.code === '15'
                  ? 'statement-risk'
                  : '';
        return `<tr class="${classes}"><td><span class="statement-label level-${row.level}" title="${esc(row.en + ' / ' + row.zh)}"><span class="statement-code">${row.code}</span><span>${esc(label(row))}</span></span></td><td title="${esc(source)}"><div class="statement-source"><span>${esc(source)}</span>${actions}</div></td>${row.manualKey ? cellInput('manual', 'project', row.manualKey, row.amount, 'number', `aria-description="${esc(row.en)}"`) : amount(row.amount)}${data.sections.map((s) => (row.code === '15' ? cellInput('risk', s.category || '', 'amount', s.amounts['15'], 'number', `title="${esc(s.label)} ${pick('风险准备金', 'Risk contingency')}"`) : amount(s.amounts[row.code]))).join('')}</tr>`;
      })
      .join('');
    content = table(heads, body, 'statement-table');
  } else if (view === 'subcontract') {
    const snapshot = data.snapshot;
    const rows = engine.buildSubcontractScopeSummary(
      snapshot.costRows,
      snapshot.resourceTypes,
      snapshot.subcontractCost,
      engine.getY1Year(snapshot.rateSettings),
    );
    content = table(
      [
        {
          label: pick('分包描述', 'Subcontract description'),
          cls: 'c-description',
        },
        { label: pick('成本 / SGD', 'Cost / SGD'), cls: 'c-number' },
      ],
      rows
        .map(
          (r) =>
            `<tr><td data-user-content>${esc(r.label)}</td>${amount(r.cost)}</tr>`,
        )
        .join('') +
        `<tr class="total-row"><td>2.3.2 ${pick('分包合计', 'Subcontract total')}</td>${amount(data.statement.find((r) => r.code === '2.3.2').amount)}</tr>`,
    );
  } else if (view === 'bu' || view === 'resource') {
    const rows = data[view];
    content = table(
      [
        {
          label:
            view === 'bu' ? 'BU' : pick('资源 / 科目', 'Resource / account'),
          cls: 'c-description',
        },
        { label: pick('归属', 'Attribution'), cls: 'c-note' },
        { label: pick('站点数', 'Sites'), cls: 'c-short' },
        { label: pick('人天', 'Mandays'), cls: 'c-short' },
        {
          label: pick('含风险成本 / SGD', 'Cost with risk / SGD'),
          cls: 'c-note',
        },
        { label: pick('占比', 'Share'), cls: 'c-short' },
      ],
      rows
        .map((r) => {
          const code = r.key.startsWith('__STATEMENT__:')
            ? r.key.slice('__STATEMENT__:'.length)
            : r.resourceCategory === 'subcontract'
              ? '2.3.2'
              : null;
          const account = data.statement.find((s) => s.code === code);
          return `<tr><td title="${esc(r.label)}">${esc(account ? `${code} · ${label(account)}` : r.label)}</td><td>${code && code !== '2.3.2' ? pick('项目科目（不强行分摊）', 'Project account (not allocated)') : pick('明细直接归属', 'Direct attribution')}</td><td class="num">${r.sites}</td><td class="num">${r.mandays}</td>${amount(r.cost)}<td class="num">${(r.shareRatio * 100).toFixed(2)}%</td></tr>`;
        })
        .join('') +
        `<tr class="total-row"><td>${pick('项目总计', 'Project total')}</td><td></td><td class="num">${rows.reduce((s, r) => s + r.sites, 0)}</td><td class="num">${rows.reduce((s, r) => s + r.mandays, 0)}</td>${amount(data.total)}<td class="num">100%</td></tr>`,
    );
  } else {
    const heads = [
      {
        label:
          view === 'group'
            ? pick('Group / 科目', 'Group / account')
            : 'Category',
        cls: 'c-note',
      },
      { label: pick('人天', 'Mandays'), cls: 'c-short' },
      ...measures.map((k) => ({ label: pick(...names[k]), cls: 'c-number' })),
      { label: pick('占比', 'Share'), cls: 'c-short' },
    ];
    const renderMeasures = (r) =>
      `<td class="num">${r.mandays}</td>${measures.map((k) => amount(r[k])).join('')}<td class="num">${data.total ? ((r.total / data.total) * 100).toFixed(2) : '0.00'}%</td>`;
    let body = '';
    for (const section of data.sections) {
      if (view === 'group') {
        body += `<tr class="statement-subtotal"><td colspan="10">${esc(section.category || pick('未分类', 'Uncategorized'))}</td></tr>`;
        for (const r of section.items) {
          const account = data.statement.find((s) => s.code === r.accountCode);
          body += `<tr><td title="${esc(r.label)}">${esc(account ? label(account) : r.label)}</td>${renderMeasures(r)}</tr>`;
        }
        body += `<tr class="total-row"><td>${esc(section.label)} ${pick('小计', 'subtotal')}</td>${renderMeasures(section.totals)}</tr>`;
      } else
        body += `<tr><td>${esc(section.category || pick('未分类', 'Uncategorized'))}</td>${renderMeasures(section.totals)}</tr>`;
    }
    const grand = {
      mandays: data.sections.reduce((s, x) => s + x.totals.mandays, 0),
      ...Object.fromEntries(
        measures.map((k) => [
          k,
          data.sections.reduce((s, x) => s + x.totals[k], 0),
        ]),
      ),
    };
    body += `<tr class="statement-grand"><td>${pick('含风险总成本', 'Total cost with risk')}</td>${renderMeasures(grand)}</tr>`;
    content = table(heads, body, 'dimension-table');
  }
  return (
    heading(
      pick('成本汇总', 'Cost summary'),
      pick(
        '成本报表为统一基准，四个维度与含风险总成本核对一致。',
        'The cost statement is the baseline; all four dimensions reconcile to the same total.',
      ),
      btn(
        pick('导出示例 CSV', 'Export sample CSV'),
        'export',
        true,
        'download',
      ),
    ) +
    `<section class="sheet">${toolbar}${content}<div class="sheet-footer"><span>${view === 'statement' ? pick('EHS = 汽车费 + 其他服务成本；其他服务成本默认按（人力 + 分包 + 结算）× 1%。', 'EHS = Car Fee + Other Service Costs; Other Service Costs default to (Labour + Subcontract + Settlement) × 1%.') : pick('项目科目仅计入一次，父级小计不重复累加。', 'Each project account is counted once; parent subtotals are not added again.')}</span><span class="grow"></span><strong>SGD ${money(data.total)}</strong><a class="text-button" href="#quote">${pick('进入报价', 'Open quotation')} →</a></div></section>`
  );
}
