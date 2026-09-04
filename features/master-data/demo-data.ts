/** Governed RE Type/rate defaults and editable subcontract references. */

import type { ResourceType } from '@/features/cost/domain';
import type { SubcontractItem } from '@/features/master-data/types';

const INTERNAL_RE_TYPES = [
  ['HQ', 'L1', 1800],
  ['HQ', 'L2', 2200],
  ['HQ', 'L3', 2600],
  ['HQ', 'L4', 3000],
  ['LOCAL', 'L1', 600],
  ['LOCAL', 'L2', 750],
  ['LOCAL', 'L3', 900],
  ['LOCAL', 'L4', 1100],
  ['ARP', 'L0', 320],
  ['ARP', 'L1', 420],
  ['ARP', 'L2', 520],
  ['ARP', 'L3', 650],
  ['ARP', 'L4', 800],
] as const;

export const initialResourceTypes: ResourceType[] = [
  ...INTERNAL_RE_TYPES.map(([pool, level, mandayRate]) => ({
    id: `rt-${pool.toLowerCase()}-${level.toLowerCase()}`,
    code: `${pool}-${level}`,
    name: `${pool === 'LOCAL' ? 'Local' : pool} ${level}`,
    category: 'internal' as const,
    pool,
    level,
    mandayRate,
    mandaysPerMonth: 21.75,
    hoursPerManday: 8,
    hqTravel: pool === 'HQ',
    effectiveFrom: '2026-01-01',
    effectiveTo: '',
    active: true,
  })),
  {
    id: 'rt-subcon',
    code: 'SUBCON',
    name: 'Subcontract Package',
    category: 'subcontract',
    pool: null,
    level: null,
    mandayRate: 0,
    mandaysPerMonth: 21.75,
    hoursPerManday: 8,
    hqTravel: false,
    effectiveFrom: '2026-01-01',
    effectiveTo: '',
    active: true,
  },
];

export const initialSubcontractItems: SubcontractItem[] = [
  {
    id: 'sub-001',
    code: 'SUB-01',
    item: 'Migration Factory Package',
    bu: 'Infrastructure BU',
    supplier: 'Supplier A',
    pricingBasis: 'Fixed price',
    currency: 'SGD',
    active: true,
  },
  {
    id: 'sub-002',
    code: 'SUB-02',
    item: 'Night Cutover Support',
    bu: 'Infrastructure BU',
    supplier: 'Supplier B',
    pricingBasis: 'Per manday',
    currency: 'SGD',
    active: true,
  },
];
