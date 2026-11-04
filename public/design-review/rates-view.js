import { pick } from './i18n.js';
import { input, table, btn } from './ui.js';
import { engine } from './business/adapter.js';
import { costInputSummary } from './business/cost-input.js';
const field = (collection, key, value, zh, en, type = 'number', extra = '') =>
  `<label class="inline-field ${type === 'number' ? 'small-field' : ''}"><span>${pick(zh, en)}</span>${input(collection, 'project', key, value, type, extra)}</label>`;
export function ratesView(state, subcontract = false) {
  const collection = subcontract ? 'subconRates' : 'rateSettings';
  const rates = subcontract ? state.subconRates : state.rateSettings;
  const actual = engine.getActualYears(state.rateSettings);
  const start = engine.getY1Year(state.rateSettings);
  const factors = subcontract
    ? engine.getSubcontractRateFactors(rates, start)
    : engine.getLabourRateFactors(rates);
  const title = subcontract
    ? pick(
        '分包年度增幅（独立设置）',
        'Subcontract annual uplift (independent)',
      )
    : pick('交付日期与人力年度增幅', 'Delivery dates & labour annual uplift');
  const annualTable = table(
    [
      { label: pick('年度 / Year', 'Year'), cls: 'c-medium' },
      ...actual.map((y, i) => ({
        label: `Y${i + 1} · ${y || '—'}`,
        cls: 'c-number',
      })),
    ],
    `<tr><td>${pick('年度增幅 %', 'Annual uplift %')}</td>${actual
      .map((y, i) => {
        const disabled =
          !rates ||
          !start ||
          (subcontract
            ? y <= rates.baseYear
            : i === 0 && start === rates.baseYear);
        return `<td class="edit">${input(collection, 'project', `uplift${i}`, disabled ? 0 : rates.annualUplifts[i], 'number', `min="-100" max="1000" ${disabled ? 'disabled' : ''}`)}</td>`;
      })
      .join(
        '',
      )}</tr><tr><td>${pick('累计费率系数', 'Cumulative rate factor')}</td>${factors.map((f) => `<td class="num">${f.toFixed(4)}×</td>`).join('')}</tr>`,
  );
  const expanded = `<section class="sheet" aria-label="${title}"><div class="toolbar"><h3>${title}</h3>${!subcontract ? ['quoteAsOf', 'tdStart', 'tdEnd'].map((key, i) => field(collection, key, rates[key], ['报价基准日', '项目开始', '项目结束'][i], ['Quote as of', 'Project start', 'Project end'][i], 'date')).join('') : ''}</div><div class="toolbar">${rates ? field(collection, 'baseYear', rates.baseYear, '费率基准年', 'Base year', 'number', 'min="2000" max="2200"') + field(collection, 'defaultUplift', rates.defaultUplift, '默认增幅 %', 'Default uplift %', 'number', 'min="-100" max="1000"') + btn(pick('按默认值重置五年', 'Reset five years'), 'reset-uplifts', false, '', `data-value="${collection}"`) : btn(pick('设置分包增幅', 'Set subcontract uplift'), 'enable-subcon-rates')}<span class="toolbar-note">${subcontract ? pick('未设置时保持原价；不继承人力增幅。', 'Flat prices until configured; labour uplift is not inherited.') : pick('Y1 对应项目开始年份；修改增幅自动重算成本。', 'Y1 follows the start year; uplifts recalculate costs.')}</span></div>${annualTable}</section>`;
  if (subcontract) return expanded;
  return `<section class="sheet" aria-label="${title}"><div class="toolbar">${field(collection, 'tdStart', rates.tdStart, '项目开始', 'Project start', 'date')}${field(collection, 'tdEnd', rates.tdEnd, '项目结束', 'Project end', 'date')}${field(collection, 'defaultUplift', rates.defaultUplift, '默认增幅 %', 'Default uplift %', 'number', 'min="-100" max="1000"')}</div><details class="details-panel" data-panel-key="personnel-rates"><summary>${pick('年度增幅与基准设置', 'Annual uplift & base settings')}</summary><div class="toolbar">${field(collection, 'quoteAsOf', rates.quoteAsOf, '报价基准日', 'Quote as of', 'date')}${field(collection, 'baseYear', rates.baseYear, '费率基准年', 'Base year', 'number', 'min="2000" max="2200"')}${btn(pick('按默认值重置五年', 'Reset five years'), 'reset-uplifts', false, '', `data-value="${collection}"`)}<span class="toolbar-note">${pick('Y1 对应项目开始年份；修改年度增幅自动重算成本。', 'Y1 follows the start year; annual uplifts recalculate costs.')}</span></div>${annualTable}</details></section>`;
}
export function inputSummaryView(snapshot) {
  const totals = costInputSummary(snapshot);
  const metric = (label, value) =>
    `<span class="metric"><span>${label}</span><strong>${value}</strong></span>`;
  return `<section class="sheet" aria-label="${pick('成本录入简要汇总', 'Cost input summary')}"><div class="metrics"><span class="muted">${pick('全部年度', 'All years')}</span>${metric(pick('人天', 'Mandays'), totals.mandays)}${metric(pick('人力成本（不含补贴）', 'HR cost (before allowance)'), amount(totals.hr))}${metric(pick('3% 补贴', '3% allowance'), amount(totals.allowance))}${metric(pick('HQ 差旅', 'HQ travel'), amount(totals.travel))}${metric(pick('人力及差旅合计', 'HR & travel total'), amount(totals.total))}</div></section>`;
}
const amount = (n) =>
  `SGD ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function travelView(state, snapshot) {
  const totals = costInputSummary(snapshot);
  return `<details class="panel details-panel" data-panel-key="personnel-travel"><summary>${pick('补贴与 HQ 差旅', 'Allowances & HQ travel')} · ${pick('3% 补贴', '3% allowance')} ${amount(totals.allowance)} · HQ travel ${amount(totals.travel)}</summary><div class="details-content"><div class="toolbar"><div class="control-group"><span class="small muted">${pick('3% 补贴适用资源', '3% allowance pools')}</span>${['LOCAL', 'ARP', 'HQ', 'OTHER'].map((pool) => `<label class="inline-field"><input type="checkbox" data-collection="allowance" data-id="${pool}" data-field="enabled" ${engine.getAllowancePools(state.rateSettings, snapshot.resourceTypes).includes(pool) ? 'checked' : ''}>${pool}</label>`).join('')}</div><strong class="small">${amount(totals.allowance)}</strong></div><div class="toolbar"><label class="inline-field"><input type="checkbox" data-collection="travelSettings" data-id="project" data-field="enabled" ${engine.isHQTravelEnabled(state.travelSettings) ? 'checked' : ''}>HQ Travel</label>${field('travelSettings', 'monthlyAllowance', state.travelSettings.monthlyAllowance, '月补贴', 'Monthly allowance')}${field('travelSettings', 'airfarePerTrip', state.travelSettings.airfarePerTrip, '单次机票', 'Airfare / trip')}${field('travelSettings', 'trips', state.travelSettings.trips, '次数', 'Trips')}<strong class="small">${amount(totals.travel)}</strong></div><p class="small muted">${pick('3% 补贴计入所选资源的人力成本。HQ 差旅按 HQ 人天分摊，不叠加年度增幅或 3% 补贴。', 'The 3% allowance is included in HR cost for selected pools. HQ travel follows HQ effort, with no uplift or 3% allowance applied to travel.')}</p></div></details>`;
}
