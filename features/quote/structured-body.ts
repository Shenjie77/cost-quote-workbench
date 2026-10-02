import type { QuoteBodyLayout, QuoteLine } from './excel-template-types.ts';
import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import { customerDocument } from './customer-document.ts';
import { categoryKey } from './quotation-groups.ts';
import { roundMoney } from '../cost/domain.ts';
import { renderTemplateText } from './template-text.ts';

export const defaultBodyTitles: QuoteBodyLayout['titles'] = {
  mandatory: 'Mandatory items for {project}',
  optional: 'Optional items (excluded from mandatory total)',
  category: '{category}',
  subtotal: '{category} Subtotal',
  mandatoryTotal: 'Total price for mandatory items',
  optionalTotal: 'Total price for optional items',
  discount: 'Service discount',
};
export type BodyRow = {
  role: keyof QuoteBodyLayout['styles'];
  description: string;
  number?: string;
  line?: QuoteLine;
  amount?: number;
  sum?: number[];
  subtract?: number;
};
function letters(index: number): string {
  let result = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(97 + ((n - 1) % 26)) + result;
  return result;
}
/** Filter empty chapters first; number only the actual, ordered customer-facing output. */
export function structuredBodyRows(
  input: QuoteWorkbookInput,
  layout: QuoteBodyLayout,
  values: Record<string, string | number | null>,
): BodyRow[] {
  const document = customerDocument(input),
    rows: BodyRow[] = [];
  let chapter = 0,
    serial = 0;
  const rank = new Map(
    layout.categoryOrder.map((name, i) => [categoryKey(name), i]),
  );
  for (const inclusion of ['mandatory', 'optional'] as const) {
    const sections = document.sections
      .filter((s) => s.inclusion === inclusion && s.lines.length)
      .sort(
        (a, b) =>
          (rank.get(categoryKey(a.category)) ?? Infinity) -
          (rank.get(categoryKey(b.category)) ?? Infinity),
      );
    if (!sections.length) continue;
    chapter++;
    const text = (pattern: string, category = '') =>
      String(
        renderTemplateText(pattern, {
          ...values,
          category,
          chapterNumber: chapter,
        }),
      );
    rows.push({
      role: 'chapter',
      number: String(chapter),
      description: text(layout.titles[inclusion]),
    });
    const subtotals: number[] = [];
    for (const [index, section] of sections.entries()) {
      const sectionNo = `${chapter}.${index + 1}`;
      rows.push({
        role: 'category',
        number: sectionNo,
        description: text(layout.titles.category, section.category),
      });
      const details: number[] = [];
      for (const [i, line] of section.lines.entries()) {
        serial++;
        details.push(rows.length);
        rows.push({
          role: 'detail',
          description: line.description,
          line,
          amount: line.amount,
          number:
            layout.numbering === 'continuous'
              ? String(serial)
              : layout.numbering === 'alphabetic'
                ? letters(i)
                : `${sectionNo}.${i + 1}`,
        });
      }
      if (layout.showSubtotals !== false) {
        subtotals.push(rows.length);
        rows.push({
          role: 'subtotal',
          description: text(
            layout.titles.subtotal === '{category} subtotal'
              ? '{category} Subtotal'
              : layout.titles.subtotal,
            section.category,
          ),
          sum: details,
          amount: roundMoney(
            section.lines.reduce((total, line) => total + line.amount, 0),
          ),
        });
      } else subtotals.push(...details);
    }
    let discount: number | undefined;
    if (inclusion === 'mandatory' && input.pricing.discount) {
      discount = rows.length;
      rows.push({
        role: 'subtotal',
        description: text(layout.titles.discount),
        amount: input.pricing.discount,
      });
    }
    rows.push({
      role: 'total',
      description: text(
        inclusion === 'mandatory'
          ? layout.titles.mandatoryTotal
          : layout.titles.optionalTotal,
      ),
      sum: subtotals,
      subtract: discount,
      amount:
        inclusion === 'mandatory' ? document.total : document.optionalAmount,
    });
  }
  return rows;
}
