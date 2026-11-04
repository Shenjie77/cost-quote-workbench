import { esc, svg } from './ui.js';
import { pick } from './i18n.js';
import { orderedColumns } from './cost-grid-preferences.js';
export function columnSettings(ids, heads, prefs) {
  const columns = orderedColumns(ids, { ...prefs, hidden: [] });
  const visible = orderedColumns(ids, prefs);
  return `<details class="panel details-panel" data-panel-key="cost-columns"><summary>${pick('列显示与顺序', 'Columns & order')}</summary><div class="details-content"><div class="option-grid">${columns
    .filter((id) => !['index', 'action'].includes(id))
    .map((id) => {
      const label = heads[ids.indexOf(id)].label;
      const previous = columns[columns.indexOf(id) - 1];
      const fixed = /^Y[1-5]:/.test(id);
      const disabled =
        !previous || previous === 'index' || /^Y[1-5]:/.test(previous);
      return `<div class="option-item"><label class="inline-field"><input type="checkbox" data-grid-column="${esc(id)}" ${visible.includes(id) ? 'checked' : ''}>${esc(label)}</label>${fixed ? '' : `<button class="icon-button" data-action="column-left" data-id="${esc(id)}" title="${esc(pick('左移列', 'Move column left'))}" aria-label="${esc(pick('左移列', 'Move column left'))} ${esc(label)}" ${disabled ? 'disabled' : ''}>←</button>`}</div>`;
    })
    .join(
      '',
    )}</div><span class="muted">${pick('勾选显示，箭头左移；Y1–Y5 保持年度顺序。', 'Check to show; arrows move columns left. Y1–Y5 stay in year order.')}</span></div></details>`;
}
export function groupActions(groups, group, locked = false) {
  const index = groups.findIndex((g) => g.id === group.id);
  const name = group.name || pick('未分组', 'Unassigned Group');
  const button = (action, zh, en, icon, disabled = false) =>
    `<button class="icon-button" data-action="${action}" data-id="${esc(group.id)}" title="${esc(pick(zh, en))}" aria-label="${esc(pick(zh, en))} ${esc(name)}" ${locked || disabled ? 'disabled' : ''}>${icon}</button>`;
  return `<div class="cell-actions actions-end">${button('group-up', '上移组', 'Move group up', '↑', index === 0)}${button('group-down', '下移组', 'Move group down', '↓', index === groups.length - 1)}${button('delete-group', '删除组', 'Delete group', svg('trash'))}</div>`;
}
