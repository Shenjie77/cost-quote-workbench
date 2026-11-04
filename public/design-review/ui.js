export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
export const svg = (name = 'grid') => {
  const paths = {
    grid: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z',
    folder: 'M3 6h7l2 3h9v11H3z',
    list: 'M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1',
    sheet: 'M4 3h16v18H4zM4 9h16M10 9v12M4 15h16',
    flow: 'M4 4h6v6H4zM14 14h6v6h-6zM10 7h7v7',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M5 12h14M14 7l5 5-5 5',
    download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
    search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    check: 'M4 12l5 5L20 6',
    chevron: 'M8 5l7 7-7 7',
    file: 'M5 3h9l5 5v13H5zM14 3v6h5',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
    trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    clock: 'M12 7v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
};
export const btn = (label, action, primary = false, icon = '', extra = '') =>
  `<button class="button ${primary ? 'primary' : ''}" data-action="${action}" ${extra}>${icon ? svg(icon) : ''}${label}</button>`;
export const badge = (text, tone = 'neutral') =>
  `<span class="badge ${tone}">${esc(text)}</span>`;
export const input = (
  collection,
  id,
  field,
  value,
  type = 'text',
  extra = '',
) =>
  `<input aria-label="${esc(field)} ${esc(id)}" data-collection="${collection}" data-id="${esc(id)}" data-field="${field}" type="${type}" ${type === 'number' ? `${extra.includes('min=') ? '' : 'min="0"'} step="any" class="num"` : ''} value="${esc(value)}" ${extra}>`;
export const select = (collection, id, field, value, options) =>
  `<select aria-label="${esc(field)} ${esc(id)}" data-collection="${collection}" data-id="${esc(id)}" data-field="${field}">${options.map((x) => `<option value="${esc(x)}" ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
export const cellInput = (...args) => `<td class="edit">${input(...args)}</td>`;
export const table = (heads, body, classes = 'generic-table') =>
  `<div class="table-scroll"><table class="${classes}"><thead><tr>${heads.map((h) => `<th ${h.cls ? `class="${h.cls}"` : ''}>${typeof h === 'string' ? h : h.label}</th>`).join('')}</tr></thead><tbody>${body || '<tr><td colspan="20" class="empty">没有匹配内容</td></tr>'}</tbody></table></div>`;
export const heading = (title, subtitle = '', actions = '') =>
  `<div class="page-heading"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
