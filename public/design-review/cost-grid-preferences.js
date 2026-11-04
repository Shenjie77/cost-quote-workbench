/** View-only preferences are isolated by project and cost version. */
export const gridKey = (state) =>
  `compact-grid:${state._source?.project.id || 'demo'}:${state._source?.activeVersion || 'V1'}`;
export function readGrid(state, storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(gridKey(state)) || '{}');
  } catch {
    return {};
  }
}
export function writeGrid(state, patch, storage = localStorage) {
  storage.setItem(
    gridKey(state),
    JSON.stringify({ ...readGrid(state, storage), ...patch }),
  );
}
export function orderedColumns(ids, prefs) {
  // Annual columns are one chronological block; remembered single-year layouts
  // must never append Y2–Y5 after totals or the row actions.
  const years = ids.filter((id) => /^Y[1-5]:/.test(id));
  const saved = (prefs.order || []).filter((id) => ids.includes(id));
  const order = saved.filter(
    (id) => !/^Y[1-5]:/.test(id) && !['index', 'action'].includes(id),
  );
  for (const id of ids.filter(
    (id) => !/^Y[1-5]:/.test(id) && !['index', 'action'].includes(id),
  )) {
    if (!order.includes(id)) {
      const next = ids
        .slice(ids.indexOf(id) + 1)
        .find((key) => order.includes(key));
      order.splice(next ? order.indexOf(next) : order.length, 0, id);
    }
  }
  const anchor = order.findIndex((id) => ['rate', 'totalCost'].includes(id));
  order.splice(anchor < 0 ? order.length : anchor, 0, ...years);
  if (ids.includes('index')) order.unshift('index');
  if (ids.includes('action')) order.push('action');
  const visible = order.filter(
    (id) =>
      !(prefs.hidden || []).includes(id) || id === 'action' || id === 'index',
  );
  return visible.length > 2 ? visible : order;
}
