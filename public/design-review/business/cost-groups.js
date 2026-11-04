/** Group order is encoded in row order so the original workspace/export schema stays intact. */
export function moveCostGroup(state, id, direction) {
  const index = state.groups.findIndex((group) => group.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.groups.length) return false;
  [state.groups[index], state.groups[target]] = [
    state.groups[target],
    state.groups[index],
  ];
  const rank = new Map(state.groups.map((group, i) => [group.id, i]));
  state.rows.sort(
    (a, b) =>
      (rank.get(a.group) ?? rank.size) - (rank.get(b.group) ?? rank.size),
  );
  return true;
}
export function removeCostGroup(state, id) {
  if (!state.groups.some((group) => group.id === id)) return false;
  state.rows = state.rows.filter((row) => row.group !== id);
  state.groups = state.groups.filter((group) => group.id !== id);
  if (!state.groups.length)
    state.groups = [{ id: 'group-0', name: '', category: '' }];
  return true;
}
