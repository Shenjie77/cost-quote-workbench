/** Durable mapping of a customer workbook; all addresses refer to the original file. */
export type QuoteExcelField =
  | 'quoteNumber'
  | 'client'
  | 'project'
  | 'costVersion'
  | 'currency'
  | 'documentTitle'
  | 'validityDays'
  | 'paymentTerms'
  | 'termsAndConditions'
  | 'assumptions'
  | 'servicePrice'
  | 'discount'
  | 'quoteBeforeTax'
  | 'gstPercent'
  | 'gstAmount'
  | 'quoteAfterTax';

/** Columns written for each output line; description and amount are required. */
export type QuoteExcelColumns = {
  description: string;
  amount: string;
  number?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
};

/** Content-addressed local asset plus a single repeatable detail-row mapping. */
export type QuoteExcelTemplate = {
  assetId: string;
  fileName: string;
  sheetName: string;
  detailRow: number;
  columns: QuoteExcelColumns;
  cells: Partial<Record<QuoteExcelField, string>>;
};

/** Safe workbook inventory returned by the local upload endpoint. */
export type QuoteExcelAsset = {
  assetId: string;
  fileName: string;
  sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
};

/** Customer-facing quotation lines never contain internal cost/rate metadata. */
export type QuoteLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
};

/** Manual entries derive their amount from quantity and unit price. */
export type ManualQuoteLine = Omit<QuoteLine, 'amount'>;
export type QuoteLineMode = 'single' | 'scope' | 'item' | 'manual';
