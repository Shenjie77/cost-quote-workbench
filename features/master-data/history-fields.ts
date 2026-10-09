/** One ordered field contract for history grids, bulk entry and XLSX templates. */
import type { BulkColumn } from './bulk-import-model.ts';
import { roundMoney } from '../cost/domain.ts';
import {
  unitAnnualMaintenanceQuote,
  type MaintenancePriceRecord,
} from './domain.ts';

export type HistoryColumn = BulkColumn & { computed?: boolean };
const text = (key: string, label: string, required = true): HistoryColumn => ({
  key,
  label,
  kind: 'text',
  required,
  description:
    (
      {
        client: 'Customer associated with this historical quotation.',
        project: 'Project name or reference description.',
        service: 'Work or service included in this quoted line.',
        productModel: 'Equipment model covered by maintenance.',
        unit: 'Pricing unit, such as site, day or lot.',
        source: 'Original quote number or source reference.',
      } as Record<string, string>
    )[key] ?? label,
});
const money = (
  key: string,
  label: string,
  computed = false,
): HistoryColumn => ({
  key,
  label,
  kind: 'number',
  min: 0,
  max: 1e12,
  required: !computed,
  computed,
  description: computed
    ? `${label}: calculated; leave blank when importing.`
    : ((
        {
          ct: 'Annual CT price per device in SGD.',
          spms: 'Annual SPMS price per device in SGD; use 0 if none.',
          quantity: 'Quantity priced at the unit price.',
          unitPrice: 'Price for one unit in SGD.',
          costAmount: 'Total cost for this line in SGD, not unit cost.',
        } as Record<string, string>
      )[key] ?? label),
});
const year: HistoryColumn = {
  key: 'quotedYear',
  label: 'Quoted Year',
  kind: 'integer',
  min: 1900,
  max: 9999,
  required: true,
  description: 'Quotation year, e.g. 2026.',
  example: 2026,
};
export const maintenanceHistoryColumns: HistoryColumn[] = [
  text('productModel', 'Model'),
  text('client', 'Client'),
  money('ct', 'CT'),
  money('spms', 'SPMS'),
  money('unitAnnualQuote', 'U/P', true),
  year,
  text('project', 'Project', false),
];
export const serviceHistoryColumns: HistoryColumn[] = [
  text('client', 'Client'),
  text('project', 'Project'),
  text('service', 'Service / Scope'),
  { ...money('quantity', 'Quantity'), min: 0.0001, max: 1e9, example: 1 },
  text('unit', 'Unit'),
  money('unitPrice', 'Unit Price'),
  money('costAmount', 'Cost'),
  money('quotedAmount', 'Quoted Amount', true),
  { ...money('grossMargin', 'GP%', true), min: -1e12, max: 100 },
  year,
  text('source', 'Reference', false),
];
export type ServicePriceRecord = {
  id: string;
  client: string;
  project: string;
  service: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  costAmount: number;
  quotedAmount: number;
  quotedYear: number;
  source: string;
  currency: 'SGD';
};
export function historyFieldValue(
  tab: string,
  key: string,
  row: Record<string, unknown>,
): unknown {
  if (tab === 'maintenance') {
    const price =
      unitAnnualMaintenanceQuote(row as unknown as MaintenancePriceRecord) ?? 0;
    if (key === 'ct') return row.ct ?? price;
    if (key === 'spms') return row.spms ?? 0;
    if (key === 'unitAnnualQuote') return price;
    if (key === 'quotedYear')
      return row.quotedYear ?? Number(String(row.quoteDate).slice(0, 4));
    if (key === 'project') return row.project ?? row.source;
  }
  if (tab === 'service-history') {
    const amount = roundMoney(Number(row.quantity) * Number(row.unitPrice));
    if (key === 'quotedAmount') return amount;
    if (key === 'grossMargin')
      return amount > 0
        ? roundMoney(((amount - Number(row.costAmount)) / amount) * 100)
        : undefined;
  }
  return row[key];
}
export function validateServiceHistory(rows: ServicePriceRecord[]): string[] {
  return rows.flatMap((row) => {
    const errors: string[] = [];
    for (const key of ['client', 'project', 'service', 'unit'] as const)
      if (!row[key]?.trim()) errors.push(`${key}: enter a value.`);
    const amount = roundMoney(row.quantity * row.unitPrice);
    if (
      !Number.isFinite(amount) ||
      amount > 1e12 ||
      row.quotedAmount !== amount
    )
      errors.push(
        'Quoted Amount must equal Quantity × Unit Price, rounded to cents.',
      );
    return errors;
  });
}
