/** Human-readable Windows-safe names; database identifiers never need to appear in paths. */
export function readableFileStem(value: string, maxLength = 40): string {
  const cleaned = Array.from(value.normalize('NFKC'))
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? '-'
        : character,
    )
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  const portable = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
  let stem = '';
  for (const character of portable) {
    if (
      (stem + character).length > maxLength ||
      new TextEncoder().encode(stem + character).length > 200
    )
      break;
    stem += character;
  }
  return stem.replace(/[. ]+$/g, '') || 'Project';
}

/** Export timestamps use the workbench's Singapore clock and include milliseconds to distinguish repeat downloads. */
export function exportTimestamp(value: string | Date = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error('Invalid export timestamp.');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}_${String(date.getUTCMilliseconds()).padStart(3, '0')}`;
}

/** Bound each physical filename while preserving its extension and a short duplicate-number suffix. */
export function readableArchiveFileName(
  original: string,
  duplicate = 1,
): string {
  const match = /^(.*?)(\.[A-Za-z0-9]{1,12})$/.exec(original);
  const extension = match?.[2] ?? '';
  const suffix = duplicate > 1 ? ` (${duplicate})` : '';
  const source = match?.[1] ?? original;
  const stamp = /_\d{8}_\d{6}_\d{3}$/.exec(source)?.[0] ?? '';
  const budget = 80 - extension.length - suffix.length - stamp.length;
  return `${readableFileStem(stamp ? source.slice(0, -stamp.length) : source, budget)}${stamp}${suffix}${extension}`;
}
