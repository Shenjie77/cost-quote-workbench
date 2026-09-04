/**
 * Supplemental master-data contracts used by the UI today and intended for
 * the future local repository/CLI. Display labels are editable, while stable
 * IDs and statement codes remain the integration keys.
 */

import { roundMoney } from '../cost/domain.ts';

export type SupplementalCostItem = {
  id: string;
  code: string;
  name: string;
  statementCode: string;
  defaultAmount: number;
  currency: 'SGD';
  owner: string;
  sourceNote: string;
  active: boolean;
};

export type MaintenancePriceRecord = {
  id: string;
  client: string;
  service: string;
  productModel: string;
  serviceLevel: string;
  site: string;
  coverageMonths: number;
  quantity: number;
  costAmount: number;
  quotedAmount: number;
  currency: 'SGD';
  quoteDate: string;
  outcome: 'Quoted' | 'Won' | 'Lost' | 'Reference';
  source: string;
};

/**
 * Annualizes a historical quoted amount for like-for-like comparison. Missing
 * or zero coverage produces zero instead of inventing a contract duration.
 */
export const annualizedMaintenanceQuote = (record: MaintenancePriceRecord) =>
  record.coverageMonths > 0
    ? roundMoney((roundMoney(record.quotedAmount) / record.coverageMonths) * 12)
    : 0;

export const initialSupplementalCostItems: SupplementalCostItem[] = [
  {
    id: 'supp-001',
    code: 'LOG-INLAND',
    name: 'Standard inland logistics reference',
    statementCode: '2.2.1.2',
    defaultAmount: 0,
    currency: 'SGD',
    owner: 'Commercial',
    sourceNote: 'Manual reference',
    active: true,
  },
  {
    id: 'supp-002',
    code: 'EHS-CAR',
    name: 'Project vehicle allowance reference',
    statementCode: '2.3.4.1',
    defaultAmount: 0,
    currency: 'SGD',
    owner: 'Project Delivery',
    sourceNote: 'Manual reference',
    active: true,
  },
];

export const initialMaintenancePriceRecords: MaintenancePriceRecord[] = [
  {
    id: 'mh-001',
    client: 'Xinglan Retail',
    service: 'Storage hardware maintenance',
    productModel: 'Storage X9000',
    serviceLevel: '24x7 · 4-hour onsite',
    site: 'Singapore DC1',
    coverageMonths: 12,
    quantity: 2,
    costAmount: 16400,
    quotedAmount: 22000,
    currency: 'SGD',
    quoteDate: '2026-05-16',
    outcome: 'Won',
    source: 'QT-2026-006',
  },
  {
    id: 'mh-002',
    client: 'Beichen Manufacturing',
    service: 'Network equipment maintenance',
    productModel: 'CoreSwitch 8800',
    serviceLevel: '8x5 · Next business day',
    site: 'Singapore Plant',
    coverageMonths: 36,
    quantity: 4,
    costAmount: 28800,
    quotedAmount: 39600,
    currency: 'SGD',
    quoteDate: '2025-11-08',
    outcome: 'Reference',
    source: 'Manual history',
  },
];
