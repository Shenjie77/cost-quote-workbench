/** Durable client-template, assumption, and quotation-history contracts. */

export type QuoteTemplate = {
  id: string;
  name: string;
  nameZh: string;
  clientPattern: string;
  documentTitle: string;
  documentTitleZh: string;
  validityDays: number;
  paymentTerms: string;
  paymentTermsZh: string;
  active: boolean;
};

export type QuoteAssumption = {
  id: string;
  text: string;
  textZh: string;
  included: boolean;
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
  note: string;
};

/** Default reusable output layout copied into a new or migrated project. */
export const initialQuoteTemplates: QuoteTemplate[] = [
  {
    id: 'quote-template-standard',
    name: 'Standard Service Quotation',
    nameZh: '标准服务报价单',
    clientPattern: '*',
    documentTitle: 'SERVICE QUOTATION',
    documentTitleZh: '服务报价单',
    validityDays: 30,
    paymentTerms: '30 days from invoice date',
    paymentTermsZh: '发票日起 30 天内付款',
    active: true,
  },
];

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
