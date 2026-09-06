import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import type { QuoteHistoryRecord } from './types.ts';
export function quoteHistoryRecord(
  input: QuoteWorkbookInput,
  artifact: { path: string; sha256: string },
  note = '',
): QuoteHistoryRecord {
  const p = input.pricing;
  return {
    id: `quote-${globalThis.crypto.randomUUID()}`,
    quoteNumber: input.quoteNumber,
    generatedAt: new Date().toISOString(),
    costVersion: input.costVersion,
    templateId: input.template.id,
    status: 'Draft',
    costAmount: p.cost,
    quoteBeforeTax: p.quoteBeforeTax,
    gstAmount: p.gstAmount,
    quoteAfterTax: p.quoteAfterTax,
    grossMarginPercent: p.grossMarginPercent,
    note: `${note} Export ${artifact.path} SHA256 ${artifact.sha256}`,
    templateSnapshot: structuredClone(input.template),
    assumptionSnapshots: structuredClone(
      input.assumptions.filter((a) => a.included),
    ),
  };
}
