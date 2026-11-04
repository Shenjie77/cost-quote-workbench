import { parity } from './parity.js';
import { pick } from './i18n.js';
import { heading, table, esc, badge } from './ui.js';
const labels = {
  integrated: ['业务已接入', 'Business connected'],
  engine: ['原算法已接入', 'Original engine connected'],
  review: ['审核交互', 'Review interaction'],
  partial: ['部分覆盖', 'Partial coverage'],
  pending: ['待迁移', 'Migration pending'],
};
export function auditView() {
  return (
    heading(
      pick('全站功能对照', 'Site-wide functional audit'),
      pick(
        '复用原领域计算、数据接口和导出器；逐项追踪简洁版业务入口。',
        'Compact workflows use the original domain calculations, persistence and exporters.',
      ),
    ) +
    `<section class="sheet"><div class="toolbar">${badge(`${parity.length} ${pick('项验收范围', 'acceptance areas')}`, 'info')}<span class="toolbar-note">${pick('已接入表示具备业务操作入口；详细验证证据见交付验收记录。', 'Connected means a live business entry point. See the acceptance record for verification evidence.')}</span></div>${table(
      [
        { label: pick('模块', 'Area'), cls: 'c-medium' },
        {
          label: pick('必须保留的业务', 'Required business behavior'),
          cls: 'c-description',
        },
        { label: pick('接入状态', 'Integration status'), cls: 'c-medium' },
        { label: pick('原站依据', 'Original source'), cls: 'c-description' },
      ],
      parity
        .map(
          ([_id, zh, en, desc, detail, source, route, status]) =>
            `<tr><td><a class="text-button" href="#${route}">${pick(zh, en)}</a></td><td class="cell-wrap">${pick(desc, detail)}</td><td>${badge(pick(...labels[status]), status === 'engine' ? 'success' : status === 'pending' ? 'warning' : 'info')}</td><td class="cell-wrap">${esc(source)}</td></tr>`,
        )
        .join(''),
    )}</section>`
  );
}
