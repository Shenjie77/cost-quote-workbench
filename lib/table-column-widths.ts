/** Reject corrupted/stale browser preferences instead of applying unusable table widths. */
export function readColumnWidths(
  raw: string | null,
  count: number,
): number[] | null {
  try {
    const widths: unknown = JSON.parse(raw ?? 'null');
    return Array.isArray(widths) &&
      widths.length === count &&
      widths.every(
        (width) =>
          typeof width === 'number' &&
          Number.isFinite(width) &&
          width >= 48 &&
          width <= 1600,
      )
      ? widths
      : null;
  } catch {
    return null;
  }
}
/** Shared progressive enhancement: semantic headers remain intact, while pointer/keyboard resizing persists locally. */
export function attachColumnResizing(table: HTMLTableElement): () => void {
  const rows = Array.from(table.tHead?.rows ?? []);
  if (!rows.length) return () => {};
  const occupied: boolean[][] = [];
  const cells: { cell: HTMLTableCellElement; index: number }[] = [];
  let count = 0;
  rows.forEach((row, r) => {
    occupied[r] ??= [];
    let col = 0;
    Array.from(row.cells).forEach((cell) => {
      while (occupied[r][col]) col++;
      for (let y = r; y < r + cell.rowSpan; y++) {
        occupied[y] ??= [];
        for (let x = col; x < col + cell.colSpan; x++) occupied[y][x] = true;
      }
      if (cell.colSpan === 1) cells.push({ cell, index: col });
      col += cell.colSpan;
      count = Math.max(count, col);
    });
  });
  const headers = Array.from(
    { length: count },
    (_, i) =>
      cells.find(({ index }) => index === i)?.cell.textContent?.trim() ??
      String(i),
  );
  const key = `workbench:grid-widths:v1:${table.getAttribute('aria-label') ?? ''}:${JSON.stringify(headers)}`;
  let cols = Array.from(
    table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'),
  );
  if (cols.length !== count) {
    // Leave complex caller-managed spanning colgroups alone.
    if (cols.length) return () => {};
    const group = document.createElement('colgroup');
    cols = Array.from({ length: count }, () => document.createElement('col'));
    cols.forEach((col) => group.appendChild(col));
    table.insertBefore(group, table.tHead);
  }
  let widths = cols.map((col, i) =>
    Math.max(
      48,
      Math.min(
        1600,
        col.getBoundingClientRect().width ||
          Number.parseFloat(col.style.width) ||
          cells.find(({ index }) => index === i)?.cell.getBoundingClientRect()
            .width ||
          100,
      ),
    ),
  );
  try {
    widths = readColumnWidths(localStorage.getItem(key), count) ?? widths;
  } catch {
    /* Resizing still works if storage is unavailable. */
  }
  const apply = () => {
    table.style.tableLayout = 'fixed';
    table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    table.style.minWidth = table.style.width;
    cols.forEach((col, i) => {
      col.style.width = `${widths[i]}px`;
    });
  };
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(widths));
    } catch {
      /* Browser storage may be disabled. */
    }
  };
  apply();
  const cleanups: (() => void)[] = [];
  cells.forEach(({ cell, index }) => {
    const handle = document.createElement('span');
    handle.setAttribute('role', 'separator');
    handle.setAttribute(
      'aria-label',
      `Resize ${headers[index] || 'column'} column`,
    );
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-valuemin', '48');
    handle.setAttribute('aria-valuemax', '1600');
    handle.setAttribute('aria-valuenow', String(widths[index]));
    handle.tabIndex = 0;
    handle.className =
      'absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20';
    if (getComputedStyle(cell).position === 'static')
      cell.style.position = 'relative';
    let start: { x: number; width: number } | null = null;
    const resize = (width: number) => {
      widths[index] = Math.max(48, Math.min(1600, width));
      handle.setAttribute('aria-valuenow', String(widths[index]));
      apply();
    };
    const move = (event: PointerEvent) => {
      if (start) resize(start.width + event.clientX - start.x);
    };
    const finish = () => {
      if (start) save();
      start = null;
    };
    handle.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      start = { x: event.clientX, width: widths[index] };
      handle.setPointerCapture(event.pointerId);
    };
    handle.onpointermove = move;
    handle.onpointerup = finish;
    handle.onpointercancel = finish;
    handle.onlostpointercapture = finish;
    handle.onclick = (event) => event.stopPropagation();
    handle.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      resize(widths[index] + (event.key === 'ArrowRight' ? 10 : -10));
      save();
    };
    cell.appendChild(handle);
    cleanups.push(() => {
      finish();
      handle.remove();
    });
  });
  return () => cleanups.forEach((cleanup) => cleanup());
}
