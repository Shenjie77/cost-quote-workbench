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

/** Original template rows owned by one customer-facing quotation module. */
export type QuoteExcelRegion = {
  source: 'service' | 'maintenance' | 'optional' | 'category';
  category?: string;
  inclusion?: 'mandatory' | 'optional';
  startRow: number;
  endRow: number;
  detailRow: number;
  /** Inclusive last sample detail row. Rows below it (e.g. subtotals) remain. */
  detailEndRow: number;
};

/** Columns written for each output line; description and amount are required. */
export type QuoteExcelColumns = {
  description: string;
  amount: string;
  number?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
};

/** One replaceable body, with reusable styles independent of category count. */
export type QuoteBodyLayout = {
  categorySpacing?: { category: string; rows: number }[];
  sectionSpacing?: { section: string; rows: number }[];
  sectionNames?: { mandatory: string; optional: string };
  /** Blank rows after headings, categories, or complete chapters (0–5 each). */
  spacing?: {
    chapterHeading?: number;
    section?: number;
    category?: number;
    mandatory?: number;
    optional?: number;
  };
  /** Omitted preserves existing templates with category subtotals. */
  showSubtotals?: boolean;
  startRow: number;
  endRow: number;
  styles: {
    chapter: number;
    category: number;
    detail: number;
    subtotal: number;
    total: number;
    /** Optional independent Grand Total prototype; old layouts reuse total. */
    grandTotal?: number;
  };
  numbering: 'hierarchical' | 'continuous' | 'alphabetic';
  categoryOrder: string[];
  titles: {
    section?: string;
    sectionTotal?: string;
    mandatory: string;
    optional: string;
    category: string;
    subtotal: string;
    mandatoryTotal: string;
    optionalTotal: string;
    discount: string;
    grandTotal?: string;
  };
};

/** Content-addressed local asset plus a single repeatable detail-row mapping. */
export type QuoteExcelTemplate = {
  body?: QuoteBodyLayout;
  /** Replacement text at original cell coordinates; a lone token preserves its numeric type. */
  textCells?: { address: string; content: string }[];
  dateFormat?: 'dd-mmm-yyyy' | 'yyyy-mm-dd' | 'dd/mm/yyyy';
  /** Fixed values such as companyName/address are local to this reusable template. */
  variables?: Record<string, string>;
  regions?: QuoteExcelRegion[];
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
  section?: string;
  category?: string;
  inclusion?: 'mandatory' | 'optional';
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
};

/** Manual entries derive their amount from quantity and unit price. */
export type ManualQuoteLine = Omit<QuoteLine, 'amount'> & {
  /** Internal relative cost basis, independent of customer price and revenue allocation. */
  costWeight?: number;
  /** Selected cost-scope references; manual weight changes detach these references. */
  costScopeKeys?: string[];
  /** Durable per-Scope shares evaluated against the latest cost source. */
  costScopeAllocations?: { key: string; percentage: number }[];
  /** Share of the project Risk Cost; omitted participates in automatic remainder allocation. */
  riskAllocationPercent?: number;
  /** Manual remainder basis excludes previously allocated risk to prevent recalculation drift. */
  unboundCostWeight?: number;
  /** Independent sales GP after project-weighted BU profit share; absent retains the saved unit price. */
  targetGrossMargin?: number;
  /** Relative weight for legacy targets; full 0–100 percentage in GP-based allocation. */
  allocationWeight?: number;
  /** Preserve the user-entered percentage when sharing the remaining target across other lines. */
  allocationFixed?: boolean;
  /** Preserve this unit price when distributing a target quotation total. */
  priceFixed?: boolean;
};
export type QuoteLineMode = 'single' | 'scope' | 'group' | 'item' | 'manual';
