// Compare entered values/formulas only: Univer normalizes styles and viewport on mount.
export function entryContent(document, selected = []) {
  const sheets = document.workbook?.sheets || {};
  return JSON.stringify([
    selected,
    Object.keys(sheets)
      .sort()
      .map((id) => [
        id,
        Object.entries(sheets[id].cellData || {}).flatMap(([r, row]) =>
          Object.entries(row)
            .filter(
              ([, c]) => c && ((c.v !== undefined && c.v !== '') || c.f || c.p),
            )
            .map(([col, c]) => [r, col, c.v ?? '', c.f || '', c.p || null]),
        ),
      ]),
  ]);
}
