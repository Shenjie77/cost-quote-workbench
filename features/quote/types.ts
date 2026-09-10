/** Durable client-template, assumption, and quotation-history contracts. */
import type { PricingResult } from './domain.ts';

export type QuoteProfitShareSnapshot = Pick<
  PricingResult,
  | 'weightedProfitShareRate'
  | 'profitShareAmount'
  | 'salesGrossProfit'
  | 'profitShareBreakdown'
> & { masterDataRevision?: number };

export type QuoteTemplate = {
  id: string;
  name: string;
  /** Legacy translation retained only to read existing project/history snapshots. */
  nameZh?: string;
  clientPattern: string;
  documentTitle: string;
  /** Legacy translation; current editors and customer outputs use documentTitle. */
  documentTitleZh?: string;
  validityDays: number;
  paymentTerms: string;
  /** Legacy translation; current editors and customer outputs use paymentTerms. */
  paymentTermsZh?: string;
  /** Free-form client T&C, preserved verbatim; no mandatory translation. */
  termsAndConditions: string;
  /** Suggested library rows copied when the user applies this template. */
  defaultAssumptionIds: string[];
  active: boolean;
};

/** Project-owned reusable library; may be explicitly copied between projects. */
export type AssumptionDefinition = {
  id: string;
  name: string;
  category: string;
  clientPattern: string;
  text: string;
  textZh: string;
  active: boolean;
};

export type QuoteAssumption = {
  id: string;
  text: string;
  textZh: string;
  included: boolean;
  /** Provenance only: deleting a library row must not delete quoted text. */
  sourceAssumptionId?: string;
};

export type QuoteHistoryStatus = 'Draft' | 'Final';

export type QuoteHistoryRecord = {
  id: string;
  quoteNumber: string;
  generatedAt: string;
  costVersion: string;
  templateId: string;
  status: QuoteHistoryStatus;
  costAmount: number;
  quoteBeforeTax: number;
  gstAmount: number;
  quoteAfterTax: number;
  grossMarginPercent: number;
  /** Effective rates and BU allocation used for this historical output. */
  profitShareSnapshot?: QuoteProfitShareSnapshot;
  note: string;
  /** Exact output text, detached from subsequent master-data edits. */
  templateSnapshot?: QuoteTemplate;
  assumptionSnapshots?: QuoteAssumption[];
};

/** Default reusable output layout copied into a new or migrated project. */
export const initialQuoteTemplates: QuoteTemplate[] = [
  {
    id: 'quote-template-standard',
    name: 'Standard Service Quotation',
    clientPattern: '*',
    documentTitle: 'SERVICE QUOTATION',
    validityDays: 30,
    paymentTerms: '30 days from invoice date',
    termsAndConditions: '',
    defaultAssumptionIds: [],
    active: true,
  },
];

/** Seed a reusable library from existing project assumptions without rewriting them. */
export function createAssumptionLibrary(
  rows: QuoteAssumption[],
): AssumptionDefinition[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.text.trim().slice(0, 80),
    category: 'General',
    clientPattern: '*',
    text: row.text,
    textZh: row.textZh,
    active: true,
  }));
}

/** Standard assumptions remain editable and can be excluded per project. */
export const initialQuoteAssumptions: QuoteAssumption[] = [
  {
    id: 'assumption-currency',
    text: 'All amounts are quoted in Singapore Dollars (SGD).',
    textZh: '所有金额均以新加坡元（SGD）报价。',
    included: true,
  },
  {
    id: 'assumption-scope',
    text: 'Work outside the agreed scope requires a change request.',
    textZh: '超出约定范围的工作需另行提交变更申请。',
    included: true,
  },
  {
    id: 'assumption-tax',
    text: 'Applicable taxes are shown separately from the pre-tax price.',
    textZh: '适用税费与未税报价分开列示。',
    included: true,
  },
];
