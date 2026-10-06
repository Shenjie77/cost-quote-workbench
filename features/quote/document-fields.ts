import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import { customerDocument } from './customer-document.ts';
import {
  templateDate,
  renderTemplateText,
  quotationProjectName,
} from './template-text.ts';

export function quoteFieldValues(
  input: QuoteWorkbookInput,
): Record<string, string | number | null> {
  const document = customerDocument(input);
  const values: Record<string, string | number | null> = {
    date: templateDate(input),
    optionalPrice: document.optionalAmount,
    grandTotal: document.total,
    companyName: input.template.excel?.variables?.companyName ?? '',
    companyAddress: input.template.excel?.variables?.companyAddress ?? '',
    documentStatus: input.documentStatus ?? 'Final',
    maintenancePrice:
      input.layout === 'customer' ||
      input.template.excel?.body ||
      input.template.excel?.regions?.length
        ? document.maintenanceAmount
        : 0,
    quoteNumber:
      input.documentStatus === 'Draft' &&
      !input.quoteNumber.startsWith('DRAFT-')
        ? `DRAFT-${input.quoteNumber}`
        : input.quoteNumber,
    client: input.project.client,
    project: quotationProjectName(input),
    costVersion: input.costVersion,
    currency: input.project.currency,
    documentTitle: input.template.documentTitle,
    validityDays: input.template.validityDays,
    paymentTerms: input.template.paymentTerms,
    termsAndConditions: input.template.termsAndConditions,
    assumptions: input.assumptions
      .filter((assumption) => assumption.included)
      .map((assumption) => assumption.text)
      .join('\n'),
    servicePrice: input.pricing.listPrice,
    discount: input.pricing.discount,
    quoteBeforeTax:
      input.layout === 'customer' ||
      input.template.excel?.body ||
      input.template.excel?.regions?.length
        ? document.total
        : input.pricing.quoteBeforeTax,
    // Existing tax mappings are deliberately cleared; both legacy total mappings receive the same final amount.
    gstPercent: null,
    gstAmount: null,
    quoteAfterTax:
      input.layout === 'customer' ||
      input.template.excel?.body ||
      input.template.excel?.regions?.length
        ? document.total
        : input.pricing.quoteBeforeTax,
  };
  // Expand only the authored T&C. Inserted customer names/addresses are literal values.
  const { termsAndConditions: _rawTerms, ...termValues } = values;
  values.termsAndConditions =
    renderTemplateText(input.template.termsAndConditions, termValues) ?? '';
  return values;
}
