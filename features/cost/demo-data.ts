/** Cost-version and cost-input fixtures kept outside production formulas. */

import type {
  CostInputRow,
  ManualCostInputs,
  RateSettings,
  TravelSettings,
} from '@/features/cost/domain';
import type { TravelCostRow } from '@/features/cost/additional-travel-domain';

export const initialCostRows: CostInputRow[] = [
  {
    id: 'CI-001',
    scope: 'Solution Design',
    bu: 'Cloud BU',
    reTypeId: 'rt-hq-l3',
    mdPerSite: 80,
    years: [
      { bucket: 'Y1', sites: 1, cost: 184000 },
      { bucket: 'Y2', sites: 0, cost: 0 },
      { bucket: 'Y3', sites: 0, cost: 0 },
      { bucket: 'Y4', sites: 0, cost: 0 },
      { bucket: 'Y5', sites: 0, cost: 0 },
    ],
  },
  {
    id: 'CI-002',
    scope: 'Migration Deployment',
    bu: 'Infrastructure BU',
    reTypeId: 'rt-local-l2',
    mdPerSite: 30,
    years: [
      { bucket: 'Y1', sites: 6, cost: 324000 },
      { bucket: 'Y2', sites: 3, cost: 162000 },
      { bucket: 'Y3', sites: 1, cost: 81000 },
      { bucket: 'Y4', sites: 1, cost: 43200 },
      { bucket: 'Y5', sites: 1, cost: 37800 },
    ],
  },
  {
    id: 'CI-003',
    scope: 'Operations Transition',
    bu: 'Professional Services',
    reTypeId: 'rt-local-l2',
    mdPerSite: 15,
    years: [
      { bucket: 'Y1', sites: 6, cost: 144000 },
      { bucket: 'Y2', sites: 4, cost: 96000 },
      { bucket: 'Y3', sites: 3, cost: 80000 },
      { bucket: 'Y4', sites: 3, cost: 64000 },
      { bucket: 'Y5', sites: 2, cost: 48000 },
    ],
  },
  {
    id: 'CI-004',
    scope: 'PMO Governance',
    bu: 'PMO',
    reTypeId: 'rt-hq-l2',
    mdPerSite: 25,
    years: [
      { bucket: 'Y1', sites: 1, cost: 75600 },
      { bucket: 'Y2', sites: 1, cost: 42000 },
      { bucket: 'Y3', sites: 1, cost: 33600 },
      { bucket: 'Y4', sites: 1, cost: 30240 },
      { bucket: 'Y5', sites: 1, cost: 28560 },
    ],
  },
  {
    id: 'CI-005',
    scope: 'Cutover Subcontract',
    bu: 'Infrastructure BU',
    reTypeId: 'rt-subcon',
    mdPerSite: 5.5,
    years: [
      { bucket: 'Y1', sites: 6, cost: 165000 },
      { bucket: 'Y2', sites: 3, cost: 90000 },
      { bucket: 'Y3', sites: 1, cost: 30000 },
      { bucket: 'Y4', sites: 1, cost: 25000 },
      { bucket: 'Y5', sites: 1, cost: 20000 },
    ],
  },
];

export const initialRateSettings: RateSettings = {
  quoteAsOf: '2026-09-04',
  tdStart: '2027-03-15',
  tdEnd: '2031-12-31',
  baseYear: 2026,
  defaultUplift: 5,
  annualUplifts: [5, 5, 5, 5, 5],
};

export const initialTravelSettings: TravelSettings = {
  monthlyAllowance: 4200,
  airfarePerTrip: 850,
  trips: 4,
};

export const initialManualCostInputs: ManualCostInputs = {
  localPurchasedEquipment: 0,
  inlandLogistics: 0,
  countryWarehousing: 0,
  nonInHouseLabour: 0,
  settlement: 0,
  carFee: 0,
  otherService: 0,
  riskContingency: 0,
};

export const initialTravelRows: TravelCostRow[] = [];

export const costLines = [
  {
    scope: 'Solution Design',
    scopeZh: '方案设计',
    type: 'Internal labour',
    typeZh: '自有人力',
    role: 'Architect',
    qty: '80 MD',
    rate: 'S$ 2,300.00 / MD',
    amount: 'S$ 184,000.00',
    source: 'TD v2',
  },
  {
    scope: 'Migration Deployment',
    scopeZh: '迁移实施',
    type: 'Internal labour',
    typeZh: '自有人力',
    role: 'Senior Engineer',
    qty: '360 MD',
    rate: 'S$ 1,800.00 / MD',
    amount: 'S$ 648,000.00',
    source: 'TD v2',
  },
  {
    scope: 'Cutover Subcontract',
    scopeZh: '割接分包',
    type: 'Subcontract',
    typeZh: '分包',
    role: 'Package SUB-02',
    qty: '66 MD',
    rate: 'Contract A17',
    amount: 'S$ 330,000.00',
    source: 'Supplier v3',
  },
  {
    scope: 'Operations Transition',
    scopeZh: '运维交接',
    type: 'Internal labour',
    typeZh: '自有人力',
    role: 'Engineer',
    qty: '270 MD',
    rate: 'Rate snapshot',
    amount: 'S$ 432,000.00',
    source: 'TD v2',
  },
];
