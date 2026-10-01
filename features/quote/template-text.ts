import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import type { QuoteExcelTemplate } from './excel-template-types.ts';

export const quoteTokens = [
  'date',
  'quoteNumber',
  'client',
  'project',
  'costVersion',
  'currency',
  'documentTitle',
  'validityDays',
  'paymentTerms',
  'termsAndConditions',
  'assumptions',
  'servicePrice',
  'discount',
  'quoteBeforeTax',
  'quoteAfterTax',
  'maintenancePrice',
  'documentStatus',
] as const;
export const fixedTokens = ['companyName', 'companyAddress'] as const;

export function templateDate(input: QuoteWorkbookInput): string {
  const issued = input.issuedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(issued)))
    throw new Error('Invalid quotation date.');
  // The workbench's quotation business date follows Singapore time, not UTC midnight.
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(issued)
    ? issued
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(issued));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    !Number.isFinite(Date.parse(raw)) ||
    new Date(raw).toISOString().slice(0, 10) !== raw
  )
    throw new Error('Invalid quotation date.');
  const [year, month, day] = raw.split('-');
  switch (input.template.excel?.dateFormat ?? 'dd-mmm-yyyy') {
    case 'yyyy-mm-dd':
      return raw;
    case 'dd/mm/yyyy':
      return `${day}/${month}/${year}`;
    default:
      return `${day}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1]}-${year}`;
  }
}

export function referencedTokens(content: string): string[] {
  return [...content.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

/** No expressions/eval: only explicitly supported public fields may be substituted. */
export function renderTemplateText(
  content: string,
  values: Record<string, string | number | null>,
): string | number | null {
  for (const token of referencedTokens(content))
    if (!Object.hasOwn(values, token))
      throw new Error(`Unknown placeholder: {${token}}.`);
  const single = /^\{([^{}]+)\}$/.exec(content);
  if (single)
    return values[single[1]] === '' ? null : (values[single[1]] ?? null);
  return (
    content.replace(/\{([^{}]+)\}/g, (_, token) =>
      String(values[token] ?? ''),
    ) || null
  );
}

export function hasTemplateField(
  mapping: QuoteExcelTemplate,
  field: string,
): boolean {
  return (
    Boolean(mapping.cells[field as keyof typeof mapping.cells]) ||
    Boolean(
      Array.isArray(mapping.textCells) &&
      mapping.textCells.some(
        (cell) =>
          typeof cell?.content === 'string' &&
          referencedTokens(cell.content).includes(field),
      ),
    )
  );
}
