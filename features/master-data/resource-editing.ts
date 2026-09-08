import type { ResourceType } from '@/features/cost/domain';

export const resourcePools = ['LOCAL', 'ARP', 'HQ'] as const;
export const resourceLevels = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
const isPool = (value: unknown): value is NonNullable<ResourceType['pool']> =>
  resourcePools.some((pool) => pool === value);
const isLevel = (value: unknown): value is NonNullable<ResourceType['level']> =>
  resourceLevels.some((level) => level === value);

/** New rows have an explicit editable classification, independent of other rows. */
export function createResourceType(
  id: string,
  suffix: string,
  effectiveFrom: string,
): ResourceType {
  return {
    id,
    code: `RE-${suffix}`,
    name: 'New RE Type',
    category: 'internal',
    pool: 'LOCAL',
    level: 'L1',
    mandayRate: 0,
    mandaysPerMonth: 21.75,
    hoursPerManday: 8,
    hqTravel: false,
    effectiveFrom,
    effectiveTo: '',
    active: true,
  };
}

/** Changes the classification and dependent fields together, preserving identity. */
export function editResourceType<K extends keyof ResourceType>(
  row: ResourceType,
  key: K,
  value: ResourceType[K],
): ResourceType {
  if (key === 'category') {
    if (value !== 'internal' && value !== 'subcontract')
      throw new Error('Select Internal or Subcontract. / 请选择自有或分包。');
    if (value === 'subcontract')
      return {
        ...row,
        category: value,
        pool: null,
        level: null,
        hqTravel: false,
      };
    const pool = row.category === 'internal' && row.pool ? row.pool : 'LOCAL';
    const level = row.category === 'internal' && row.level ? row.level : 'L1';
    return { ...row, category: value, pool, level, hqTravel: pool === 'HQ' };
  }
  if (key === 'pool') {
    if (row.category !== 'internal' || !isPool(value))
      throw new Error(
        'Pool requires an internal RE Type. / 自有 RE Type 才能设置 Pool。',
      );
    return {
      ...row,
      pool: value,
      hqTravel: value === 'HQ',
    };
  }
  if (key === 'level') {
    if (row.category !== 'internal' || !isLevel(value))
      throw new Error(
        'Level requires an internal RE Type. / 自有 RE Type 才能设置 Level。',
      );
  }
  return { ...row, [key]: value };
}

/** Surface imported inconsistencies without reclassifying them automatically. */
export function resourceClassificationIssue(row: ResourceType): string | null {
  if (row.category === 'subcontract')
    return row.pool !== null || row.level !== null || row.hqTravel
      ? 'Subcontract must have no Pool, Level or HQ travel. / 分包不可设置 Pool、Level 或 HQ 差旅。'
      : null;
  if (row.category !== 'internal') return 'Select a Category. / 请选择种类。';
  if (!isPool(row.pool) || !isLevel(row.level))
    return 'Internal requires a valid Pool and Level. / 自有人员必须选择有效的 Pool 和 Level。';
  if (row.hqTravel && row.pool !== 'HQ')
    return 'HQ travel applies only to HQ. / 仅 HQ 人员可启用 HQ 差旅。';
  return null;
}
