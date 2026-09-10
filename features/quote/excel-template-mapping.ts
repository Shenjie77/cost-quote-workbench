/** Shared validation for original-workbook coordinates used by the editor and exporter. */
import type {
  QuoteExcelAsset,
  QuoteExcelColumns,
  QuoteExcelField,
  QuoteExcelTemplate,
} from './excel-template-types.ts';

/** Bound row expansion and parsing work for local workbook templates. */
export const MAX_QUOTE_TEMPLATE_ROW = 20_000;

/** Quotations must identify the recipient and show complete prices and basic commercial terms. */
export const requiredQuoteExcelFields: ReadonlyArray<QuoteExcelField> = [
  'quoteNumber',
  'client',
  'project',
  'quoteBeforeTax',
  'gstAmount',
  'quoteAfterTax',
  'validityDays',
  'paymentTerms',
];

/** Supported output fields are explicit so workbook mappings cannot expose internal data. */
const fields = new Set<QuoteExcelField>([
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
  'gstPercent',
  'gstAmount',
  'quoteAfterTax',
]);

/** Excel's final supported column is XFD (16,384); addresses use uppercase A1 notation. */
function validColumn(column: unknown): column is string {
  if (typeof column !== 'string' || !/^[A-Z]{1,3}$/.test(column)) return false;
  let number = 0;
  for (const letter of column) number = number * 26 + letter.charCodeAt(0) - 64;
  return number <= 16384;
}

/** A plain record excludes arrays and null before reading user-supplied mapping properties. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validate coordinates without mutating the mapping; workbook merge/formula checks run on export. */
export function validateQuoteExcelMapping(
  mapping: QuoteExcelTemplate,
  sheets?: QuoteExcelAsset['sheets'],
): string[] {
  if (!isRecord(mapping)) return ['An Excel template mapping is required.'];
  const errors: string[] = [];
  if (
    typeof mapping.assetId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(mapping.assetId)
  )
    errors.push('Upload a local Excel template first.');
  if (
    typeof mapping.fileName !== 'string' ||
    !/\.xlsx$/i.test(mapping.fileName)
  )
    errors.push('The template must be an .xlsx file.');
  if (typeof mapping.sheetName !== 'string' || !mapping.sheetName.trim())
    errors.push('Select the worksheet containing the quotation detail row.');
  else if (sheets && !sheets.some((sheet) => sheet.name === mapping.sheetName))
    errors.push('The selected worksheet is not present in this workbook.');
  if (
    !Number.isInteger(mapping.detailRow) ||
    mapping.detailRow < 1 ||
    mapping.detailRow > MAX_QUOTE_TEMPLATE_ROW
  )
    errors.push(
      `Detail row must be an integer from 1 to ${MAX_QUOTE_TEMPLATE_ROW}.`,
    );

  // Each line value has its own destination so writes cannot silently replace one another.
  const columns = mapping.columns;
  if (!isRecord(columns))
    errors.push('Description and amount columns are required.');
  else {
    const supported = new Set<keyof QuoteExcelColumns>([
      'description',
      'amount',
      'number',
      'quantity',
      'unit',
      'unitPrice',
    ]);
    const used = new Set<string>();
    for (const required of ['description', 'amount'] as const)
      if (!columns[required])
        errors.push(`The ${required} column is required.`);
    for (const [field, column] of Object.entries(columns)) {
      if (!supported.has(field as keyof QuoteExcelColumns))
        errors.push(`Unsupported detail column: ${field}.`);
      if (!validColumn(column))
        errors.push(`The ${field} column must be a letter from A to XFD.`);
      else if (used.has(column))
        errors.push(
          `Column ${column} is assigned to more than one detail field.`,
        );
      else used.add(column);
    }
  }

  // Metadata uses original A1 coordinates; it cannot share the repeatable line or another field.
  if (!isRecord(mapping.cells))
    errors.push('Metadata cell mappings must be an object.');
  else {
    const used = new Set<string>();
    for (const field of requiredQuoteExcelFields)
      if (!mapping.cells[field])
        errors.push(
          `The ${field} cell is required for complete quotation output.`,
        );
    for (const [field, address] of Object.entries(mapping.cells)) {
      if (!fields.has(field as QuoteExcelField))
        errors.push(`Unsupported quotation field: ${field}.`);
      const match =
        typeof address === 'string' && /^([A-Z]{1,3})([1-9]\d*)$/.exec(address);
      if (
        !match ||
        !validColumn(match[1]) ||
        Number(match[2]) > MAX_QUOTE_TEMPLATE_ROW
      )
        errors.push(
          `The ${field} cell must be an address from A1 to XFD${MAX_QUOTE_TEMPLATE_ROW}.`,
        );
      else if (Number(match[2]) === mapping.detailRow)
        errors.push(
          `The ${field} cell cannot be on the repeatable detail row.`,
        );
      if (typeof address === 'string') {
        if (used.has(address))
          errors.push(`Cell ${address} is assigned to more than one field.`);
        used.add(address);
      }
    }
  }
  return errors;
}
