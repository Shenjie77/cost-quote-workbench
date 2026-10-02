import { categoryKey } from './quotation-groups.ts';
import { fixedTokens, quoteTokens, referencedTokens } from './template-text.ts';
/** Shared validation for original-workbook coordinates used by the editor and exporter. */
import type {
  QuoteExcelAsset,
  QuoteExcelColumns,
  QuoteExcelField,
  QuoteExcelTemplate,
} from './excel-template-types.ts';

/** Bound row expansion and parsing work for local workbook templates. */
export const MAX_QUOTE_TEMPLATE_ROW = 20_000;

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
      else if (
        !mapping.regions?.length &&
        Number(match[2]) === mapping.detailRow
      )
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
  const addressValid = (value: string) => {
    const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(value);
    return Boolean(
      match &&
      validColumn(match[1]) &&
      Number(match[2]) <= MAX_QUOTE_TEMPLATE_ROW,
    );
  };
  const allowed = new Set<string>([...quoteTokens, ...fixedTokens]);
  if (
    mapping.dateFormat &&
    !['dd-mmm-yyyy', 'yyyy-mm-dd', 'dd/mm/yyyy'].includes(mapping.dateFormat)
  )
    errors.push('Select a supported date format.');
  for (const [key, value] of Object.entries(mapping.variables ?? {})) {
    if (
      !fixedTokens.includes(key as (typeof fixedTokens)[number]) ||
      typeof value !== 'string' ||
      value.length > 4000
    )
      errors.push(`Invalid fixed template value: ${key}.`);
  }
  const occupied = new Set(Object.values(mapping.cells ?? {}));
  if (
    mapping.textCells &&
    (!Array.isArray(mapping.textCells) || mapping.textCells.length > 100)
  )
    errors.push('Use at most 100 text cells.');
  else
    for (const cell of mapping.textCells ?? []) {
      if (
        !cell ||
        typeof cell.address !== 'string' ||
        !addressValid(cell.address)
      ) {
        errors.push('Text cells require a valid original cell address.');
        continue;
      }
      if (occupied.has(cell.address))
        errors.push(`Cell ${cell.address} is assigned more than once.`);
      occupied.add(cell.address);
      if (
        !mapping.regions?.length &&
        Number(cell.address.match(/\d+$/)?.[0]) === mapping.detailRow
      )
        errors.push(
          `Text cell ${cell.address} cannot be on the repeatable detail row.`,
        );
      if (typeof cell.content !== 'string' || cell.content.length > 10000) {
        errors.push(`Invalid content for ${cell.address}.`);
        continue;
      }
      if (/[{}]/.test(cell.content.replace(/\{[^{}]+\}/g, '')))
        errors.push(`Unmatched braces in ${cell.address}.`);
      for (const token of referencedTokens(cell.content))
        if (!allowed.has(token))
          errors.push(`Unknown placeholder: {${token}}.`);
    }
  const regions = mapping.regions ?? [];
  if (
    !Array.isArray(regions) ||
    regions.length > 50 ||
    regions.some((region) => !isRecord(region))
  )
    errors.push('Use at most 50 quotation regions.');
  else {
    if (
      regions.some((r) => r.source === 'optional') &&
      regions.some((r) => r.source !== 'optional' && r.inclusion === 'optional')
    )
      errors.push(
        'Use either All Optional categories or separate Optional category regions, not both.',
      );
    const sources = new Set<string>();
    const sorted = [...regions].sort((a, b) => a.startRow - b.startRow);
    for (const [index, region] of sorted.entries()) {
      if (
        !['service', 'maintenance', 'optional', 'category'].includes(
          region.source,
        ) ||
        sources.has(
          region.source === 'optional'
            ? 'all-optional'
            : categoryKey(
                region.source === 'category'
                  ? (region.category ?? '')
                  : region.source === 'service'
                    ? 'Professional Service'
                    : 'Maintenance',
              ) +
                ':' +
                (region.inclusion ?? 'mandatory'),
        )
      )
        errors.push('Each quotation module can be mapped only once.');
      sources.add(
        region.source === 'optional'
          ? 'all-optional'
          : categoryKey(
              region.source === 'category'
                ? (region.category ?? '')
                : region.source === 'service'
                  ? 'Professional Service'
                  : 'Maintenance',
            ) +
              ':' +
              (region.inclusion ?? 'mandatory'),
      );
      if (
        region.source === 'category' &&
        (typeof region.category !== 'string' ||
          !region.category.trim() ||
          region.category.length > 120)
      )
        errors.push('Enter a category title (1–120 characters).');
      if (
        region.inclusion !== undefined &&
        !['mandatory', 'optional'].includes(region.inclusion)
      )
        errors.push('Choose Mandatory or Optional.');
      if (
        ![
          region.startRow,
          region.endRow,
          region.detailRow,
          region.detailEndRow,
        ].every(
          (value) =>
            Number.isInteger(value) &&
            value >= 1 &&
            value <= MAX_QUOTE_TEMPLATE_ROW,
        ) ||
        region.startRow > region.detailRow ||
        region.detailRow > region.detailEndRow ||
        region.detailEndRow > region.endRow
      )
        errors.push(
          'Region rows must satisfy start ≤ first detail ≤ last detail ≤ end.',
        );
      if (index && sorted[index - 1].endRow >= region.startRow)
        errors.push('Quotation regions cannot overlap.');
      for (const address of occupied) {
        const row = Number(address?.match(/\d+$/)?.[0]);
        if (row >= region.detailRow && row <= region.detailEndRow)
          errors.push(`Map ${address} outside repeated detail rows.`);
      }
    }
  }
  return errors;
}
