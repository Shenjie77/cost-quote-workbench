/** Human-readable guidance lives in the header, never in an importable sample row. */
export type GuidedColumn = {
  key: string;
  label: string;
  kind?: string;
  description?: string;
  required?: boolean;
  requiredForNew?: boolean;
  requiredTogether?: string;
  computed?: boolean;
  example?: string | number | boolean;
  options?: string[];
};

export function entrySample(column: GuidedColumn): string {
  if (column.computed) return 'Leave blank (calculated)';
  if (column.key === 'id') return 'Leave blank for a new record';
  if (column.example !== undefined) return String(column.example);
  if (column.options?.length) return column.options[0];
  const samples: Record<string, string> = {
    client: 'Example Customer',
    project: 'Network upgrade',
    service: 'Installation service',
    productModel: 'NE8000',
    unit: 'site',
    source: 'QT-2026-001',
    groupName: 'Deployment',
    scope: 'Install and test',
    bu: 'Network',
    reType: 'LOCAL-L1',
    code: 'SC-001',
    description: 'Installation service',
    quantity: '3',
    unitPrice: '500',
    costAmount: '900',
    ct: '100',
    spms: '25',
    quotedYear: '2026',
    name: 'Example name',
  };
  return (
    samples[column.key] ??
    {
      number: '2.5',
      integer: '2',
      date: '2026-10-09',
      boolean: 'TRUE',
      list: 'Alpha; Beta',
    }[column.kind ?? 'text'] ??
    'Example text'
  );
}

export function entryHeader(column: GuidedColumn): string {
  const star =
    column.required || column.requiredForNew || column.requiredTogether
      ? ' *'
      : '';
  const condition = column.requiredForNew
    ? 'Required for new records. '
    : column.requiredTogether
      ? `${column.requiredTogether} `
      : '';
  return `${column.label}${star}\n${condition}${column.description || (column.kind === 'number' || column.kind === 'integer' ? 'Enter a numeric value.' : 'Enter text.')}\nSample: ${entrySample(column)}`;
}

export function entryHeaderHeight(columns: GuidedColumn[]): number {
  return Math.max(
    96,
    ...columns.map(
      (column) =>
        entryHeader(column)
          .split('\n')
          .reduce(
            (lines, text) => lines + Math.max(1, Math.ceil(text.length / 28)),
            0,
          ) *
          17 +
        16,
    ),
  );
}
