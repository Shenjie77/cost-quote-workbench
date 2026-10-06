import { discountGroupKey } from './discount-allocation.ts';
import type { QuoteBodyLayout, QuoteLine } from './excel-template-types.ts';
import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import { customerDocument } from './customer-document.ts';
import { categoryKey } from './quotation-groups.ts';
import { roundMoney } from '../cost/domain.ts';
import { renderTemplateText } from './template-text.ts';

export const defaultBodyTitles: QuoteBodyLayout['titles'] = {
  mandatory: '{section} items for {project}',
  optional: '{section} items (excluded from mandatory total)',
  category: '{category}',
  subtotal: '{category} Subtotal',
  mandatoryTotal: 'Total price for {section} items',
  optionalTotal: 'Total price for {section} items',
  discount: 'Discount',
  grandTotal: 'Grand Total',
};
/** Upgrade only earlier generated defaults; retain authored heading wording. */
export function normalizedBodyTitles(
  titles: QuoteBodyLayout['titles'],
): QuoteBodyLayout['titles'] {
  const old = {
    mandatory: 'Mandatory items for {project}',
    optional: 'Optional items (excluded from mandatory total)',
    mandatoryTotal: 'Total price for mandatory items',
    optionalTotal: 'Total price for optional items',
    subtotal: '{category} subtotal',
  };
  const next = { ...defaultBodyTitles, ...titles };
  for (const key of Object.keys(old) as (keyof typeof old)[])
    if (next[key] === old[key]) next[key] = defaultBodyTitles[key];
  return next;
}
export type BodyRow = {
  role: keyof QuoteBodyLayout['styles'] | 'blank';
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
  const blank = (count = 0) => {
    for (let i = 0; i < count; i++)
      rows.push({ role: 'blank', description: '' });
  };
  const titles = normalizedBodyTitles(layout.titles);
  const allocation = document.allocation;
  const grandTotals: number[] = [];
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
    const sectionName =
      layout.sectionNames?.[inclusion] ||
      (inclusion === 'mandatory' ? 'Mandatory' : 'Optional');
    const text = (pattern: string, category = '') =>
      String(
        renderTemplateText(pattern, {
          ...values,
          category,
          section: sectionName,
          chapterNumber: chapter,
        }),
      );
    rows.push({
      role: 'chapter',
      number: String(chapter),
      description: text(titles[inclusion]),
    });
    blank(layout.spacing?.chapterHeading);
    const subtotals: number[] = [];
    for (const [index, section] of sections.entries()) {
      const sectionNo = `${chapter}.${index + 1}`;
      rows.push({
        role: 'category',
        number: sectionNo,
        description: text(titles.category, section.category),
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
      const categoryDiscount =
        allocation.mode === 'category'
          ? (allocation.rows.find(
              (r) => r.key === discountGroupKey(inclusion, section.category),
            )?.discount ?? 0)
          : 0;
      let categoryDiscountRow: number | undefined;
      if (categoryDiscount) {
        categoryDiscountRow = rows.length;
        rows.push({
          role: 'subtotal',
          description: text(titles.discount, section.category),
          amount: categoryDiscount,
        });
      }
      if (layout.showSubtotals !== false || categoryDiscount) {
        subtotals.push(rows.length);
        rows.push({
          role: 'subtotal',
          description: text(
            titles.subtotal === '{category} subtotal'
              ? '{category} Subtotal'
              : titles.subtotal,
            section.category,
          ),
          sum: details,
          subtract: categoryDiscountRow,
          amount: roundMoney(
            section.lines.reduce((total, line) => total + line.amount, 0) -
              categoryDiscount,
          ),
        });
      } else subtotals.push(...details);
      blank(
        layout.categorySpacing?.find(
          (rule) =>
            categoryKey(rule.category) === categoryKey(section.category),
        )?.rows ?? layout.spacing?.category,
      );
    }
    let discount: number | undefined;
    const sectionDiscount =
      allocation.mode === 'section'
        ? (allocation.rows.find((r) => r.key === discountGroupKey(inclusion))
            ?.discount ?? 0)
        : 0;
    if (sectionDiscount) {
      discount = rows.length;
      rows.push({
        role: 'subtotal',
        description: text(titles.discount),
        amount: sectionDiscount,
      });
    }
    if (inclusion === 'mandatory') grandTotals.push(rows.length);
    rows.push({
      role: 'total',
      description: text(
        inclusion === 'mandatory'
          ? titles.mandatoryTotal
          : titles.optionalTotal,
      ),
      sum: subtotals,
      subtract: discount,
      amount:
        inclusion === 'mandatory'
          ? allocation.mode === 'total'
            ? allocation.mandatoryGross
            : document.total
          : document.optionalAmount,
    });
    blank(layout.spacing?.[inclusion]);
  }
  let totalDiscount: number | undefined;
  if (allocation.mode === 'total' && input.pricing.discount) {
    totalDiscount = rows.length;
    rows.push({
      role: 'subtotal',
      description: String(
        renderTemplateText(titles.discount, {
          ...values,
          section: layout.sectionNames?.mandatory || 'Mandatory',
          category: '',
          chapterNumber: '',
        }),
      ),
      amount: input.pricing.discount,
    });
  }
  rows.push({
    role: 'total',
    description: String(
      renderTemplateText(titles.grandTotal!, {
        ...values,
        section: layout.sectionNames?.mandatory || 'Mandatory',
        category: '',
        chapterNumber: '',
      }),
    ),
    sum: grandTotals,
    subtract: totalDiscount,
    amount: document.total,
  });
  return rows;
}
