import { pick } from './i18n.js';
import { esc, btn, table, heading, badge } from './ui.js';
import { reviewData } from './business/adapter.js';
import { captureCost, restoreCost } from './business/review-versions.js';
export { captureCost, restoreCost };
export function versionBar(versions, current, confirming) {
  return `<div class="toolbar"><label class="inline-field"><span>${pick('成本版本', 'Cost version')}</span><select id="cost-version">${versions.map((v) => `<option value="${v.code}" ${v.code === current ? 'selected' : ''}>${v.code} · ${v.state || (v.confirmed ? 'Confirmed' : 'Draft')}</option>`).join('')}</select></label>${btn(pick('复制为新 Draft', 'Copy to new Draft'), 'version-copy')}${btn(pick('新建空白', 'New blank'), 'version-blank')}${btn(pick('确认成本', 'Confirm cost'), 'version-confirm', false, '', versions.find((v) => v.code === current).confirmed ? 'disabled' : '')}<a class="text-button" href="#compare">${pick('版本对比', 'Compare versions')}</a><span class="toolbar-note">${pick('审核版本仅保留在本页；不推进正式项目流程。', 'Review versions stay in this session; production workflow is not advanced.')}</span></div>${confirming ? `<div class="toolbar"><span>${pick('确认后本版成本只读，后续修改需复制新 Draft。', 'Confirmation makes this cost version read-only; copy a new draft for changes.')}</span>${btn(pick('确认并锁定示例', 'Confirm & lock sample'), 'version-lock', true)}${btn(pick('取消', 'Cancel'), 'version-cancel')}</div>` : ''}`;
}
export function compareView(state, versions, current, against) {
  const version = versions.find((v) => v.code === against) || versions[0],
    left = reviewData({ ...state, ...version.snapshot }),
    right = reviewData(state);
  return (
    heading(
      pick('成本版本对比', 'Cost version comparison'),
      pick(
        '按同一科目对比已捕获数据，不改写旧版本。',
        'Compare captured costs using the same accounts without rewriting older versions.',
      ),
    ) +
    `<section class="sheet"><div class="toolbar"><label class="inline-field"><span>${pick('基准版本', 'Baseline')}</span><select id="compare-version">${versions.map((v) => `<option value="${v.code}" ${v.code === version.code ? 'selected' : ''}>${v.code}</option>`).join('')}</select></label>${badge(`${version.code} → ${current}`)}</div>${table([{ label: pick('科目', 'Account'), cls: 'c-description' }, version.code, current, pick('差额', 'Delta')], right.statement.map((r, i) => `<tr><td>${esc(r.code)} ${esc(pick(r.zh, r.en))}</td><td class="num">${left.statement[i].amount.toFixed(2)}</td><td class="num">${r.amount.toFixed(2)}</td><td class="num">${(r.amount - left.statement[i].amount).toFixed(2)}</td></tr>`).join(''))}</section>`
  );
}
