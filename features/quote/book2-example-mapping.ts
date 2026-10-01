import type { QuoteExcelTemplate } from './excel-template-types.ts';

/** Stages original Book2 coordinates for review; never edits or uploads a source workbook. */
export function book2ExampleMapping(
  base: QuoteExcelTemplate,
): QuoteExcelTemplate {
  return {
    ...base,
    detailRow: 17,
    columns: {
      number: 'B',
      description: 'C',
      unit: 'D',
      unitPrice: 'E',
      quantity: 'F',
      amount: 'G',
    },
    cells: { quoteBeforeTax: 'G25' },
    dateFormat: 'dd-mmm-yyyy',
    regions: [
      {
        source: 'service',
        startRow: 15,
        endRow: 19,
        detailRow: 17,
        detailEndRow: 19,
      },
      {
        source: 'maintenance',
        startRow: 20,
        endRow: 23,
        detailRow: 21,
        detailEndRow: 23,
      },
      {
        source: 'optional',
        startRow: 27,
        endRow: 31,
        detailRow: 29,
        detailEndRow: 29,
      },
    ],
    textCells: [
      { address: 'B2', content: '' },
      { address: 'B4', content: '{companyName}' },
      { address: 'B5', content: '{companyAddress}' },
      { address: 'B6', content: '' },
      { address: 'B7', content: '' },
      { address: 'C9', content: '{client}' },
      { address: 'B10', content: 'Quotation No.: {quoteNumber}' },
      { address: 'B11', content: 'Quotation for {project}' },
      { address: 'B12', content: 'Date of quotation: {date}' },
      { address: 'C14', content: 'Description' },
      { address: 'C15', content: 'Mandatory items for {project}' },
      { address: 'B24', content: 'Discount' },
      { address: 'G24', content: '{discount}' },
      { address: 'C33', content: 'Assumptions: {assumptions}' },
      { address: 'C37', content: '{termsAndConditions}' },
      { address: 'C38', content: 'Payment terms: {paymentTerms}' },
      { address: 'C39', content: 'Validity: {validityDays} days' },
      { address: 'C40', content: '' },
      { address: 'C41', content: '' },
    ],
  };
}
