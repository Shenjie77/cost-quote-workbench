/** Read bounded Excel paste, CSV and Markdown without changing business cells. */
export const BULK_TABLE_LIMITS = {
  characters: 1_000_000,
  rows: 1000,
  columns: 40,
} as const;

export type MatrixRow = { sourceRow: number; cells: string[] };
export function readBulkTable(text: string): {
  rows: MatrixRow[];
  issues: string[];
  notices: string[];
} {
  if (text.length > BULK_TABLE_LIMITS.characters)
    return {
      rows: [],
      issues: ['Paste at most 1,000,000 characters per batch.'],
      notices: [],
    };
  let value = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const notices: string[] = [];
  let lineOffset = 0;
  const sourceLines = value.split('\n');
  const firstLine = sourceLines.findIndex((line) => line.trim());
  const fence =
    firstLine < 0
      ? null
      : /^(`{3,}|~{3,})(?:markdown|md)?\s*$/i.exec(
          sourceLines[firstLine].trim(),
        );
  if (fence) {
    const lastLine = sourceLines.findLastIndex((line) => line.trim());
    const closing = sourceLines[lastLine].trim();
    if (
      lastLine === firstLine ||
      closing.length < fence[1].length ||
      !Array.from(closing).every((char) => char === fence[1][0])
    )
      return {
        rows: [],
        issues: [
          'Markdown code fence is not closed. Paste the complete table and its closing fence.',
        ],
        notices: [],
      };
    value = sourceLines.slice(firstLine + 1, lastLine).join('\n');
    lineOffset = firstLine + 1;
    notices.push('Markdown code fence removed; table contents retained.');
  }
  const first = value.split('\n').find((line) => line.trim()) || '';
  const delimiter = first.includes('\t')
    ? '\t'
    : first.includes('|')
      ? '|'
      : first.includes(',')
        ? ','
        : /\S {2,}\S/.test(first)
          ? 'spaces'
          : ',';
  const records: MatrixRow[] = [];
  const issues: string[] = [];
  let cells: string[] = [],
    cell = '',
    quoted = false,
    afterQuote = false,
    line = 1 + lineOffset,
    startLine = 1 + lineOffset;
  const addRow = () => {
    cells.push(cell.trim());
    if (delimiter === '|') {
      if (!cells[0]) cells.shift();
      if (!cells.at(-1)) cells.pop();
    }
    if (cells.some((item) => item.trim())) {
      if (
        delimiter === '|' &&
        cells.every((item) => /^:?-{3,}:?$/.test(item.trim()))
      )
        notices.push(`Row ${startLine}: Markdown separator ignored.`);
      else records.push({ sourceRow: startLine, cells });
    }
    cells = [];
    cell = '';
    afterQuote = false;
  };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        cell += char;
        if (char === '\n') line++;
      }
      continue;
    }
    if (char === '"' && !cell.trim() && !afterQuote) {
      quoted = true;
      continue;
    }
    const isDelimiter =
      delimiter === 'spaces'
        ? char === ' ' && value[index + 1] === ' '
        : char === delimiter;
    if (isDelimiter) {
      cells.push(cell.trim());
      cell = '';
      afterQuote = false;
      if (delimiter === 'spaces') while (value[index + 1] === ' ') index++;
    } else if (char === '\n') {
      addRow();
      line++;
      startLine = line;
      if (records.length > BULK_TABLE_LIMITS.rows + 2)
        return {
          rows: [],
          issues: ['Paste at most 1,000 data rows per batch.'],
          notices: [],
        };
    } else if (afterQuote && char.trim()) {
      issues.push(
        `Row ${line}: unexpected text after a quoted cell. Check delimiters and quotation marks.`,
      );
      afterQuote = false;
      cell += char;
    } else cell += char;
    if (cells.length > BULK_TABLE_LIMITS.columns + 2)
      return {
        rows: [],
        issues: ['Use at most 40 columns per batch.'],
        notices: [],
      };
  }
  if (quoted) issues.push(`Row ${startLine}: quotation marks are not closed.`);
  addRow();
  if (records.length > BULK_TABLE_LIMITS.rows + 2)
    issues.push('Paste at most 1,000 data rows per batch.');
  return { rows: records, issues, notices };
}
