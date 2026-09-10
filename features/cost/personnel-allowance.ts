/** Personnel allowance selection, including compatibility with saved versions. */
import type { RateSettings, ResourceType } from './domain.ts';

export const PERSONNEL_ALLOWANCE_POOLS = [
  'LOCAL',
  'ARP',
  'HQ',
  'OTHER',
] as const;
export type AllowancePool = (typeof PERSONNEL_ALLOWANCE_POOLS)[number];

type AllowanceSelectionIssue = {
  code: string;
  path: string;
  message: string;
};

/** Pool selection takes priority; reading an old ID selection never expands its scope. */
export function isPersonnelAllowanceApplied(
  resource: ResourceType,
  settings: RateSettings,
): boolean {
  if (resource.category !== 'internal') return false;

  // An explicitly saved pool selection is authoritative, including an empty array.
  const pools = settings.allowancePools;
  if (pools !== undefined) {
    return (
      Array.isArray(pools) &&
      resource.pool !== null &&
      pools.includes(resource.pool)
    );
  }

  // Legacy individual choices retain exactly their original resource scope.
  const resourceIds = settings.allowanceResourceTypeIds;
  if (resourceIds !== undefined) {
    return Array.isArray(resourceIds) && resourceIds.includes(resource.id);
  }

  return (
    settings.localArpAllowanceEnabled === true &&
    (resource.pool === 'LOCAL' || resource.pool === 'ARP')
  );
}

/** Checkbox projection only: legacy individual selections remain unchanged until an explicit edit. */
export function getAllowancePools(
  settings: RateSettings,
  resources: ResourceType[],
): AllowancePool[] {
  const selectedPools = settings.allowancePools;
  if (selectedPools !== undefined) {
    return Array.isArray(selectedPools)
      ? PERSONNEL_ALLOWANCE_POOLS.filter((pool) => selectedPools.includes(pool))
      : [];
  }
  if (settings.allowanceResourceTypeIds === undefined) {
    return settings.localArpAllowanceEnabled === true ? ['LOCAL', 'ARP'] : [];
  }

  // Project IDs onto the fixed checkbox order without mutating the saved settings.
  return PERSONNEL_ALLOWANCE_POOLS.filter((pool) =>
    resources.some(
      (resource) =>
        resource.pool === pool &&
        isPersonnelAllowanceApplied(resource, settings),
    ),
  );
}

/** Returns selected internal resource IDs in the captured rate-card order. */
export function getAllowanceResourceTypeIds(
  settings: RateSettings,
  resources: ResourceType[],
): string[] {
  return resources
    .filter((resource) => isPersonnelAllowanceApplied(resource, settings))
    .map((resource) => resource.id);
}

/** Validates explicit pool selections while preserving issue order and duplicate rules. */
function validateAllowancePools(
  selection: AllowancePool[],
): AllowanceSelectionIssue[] {
  if (!Array.isArray(selection)) {
    return [
      {
        code: 'INVALID_ALLOWANCE_POOLS',
        path: '/rateSettings/allowancePools',
        message:
          'Personnel allowance pools must be an array of LOCAL, ARP, HQ or OTHER.',
      },
    ];
  }

  const issues: AllowanceSelectionIssue[] = [];
  const seenPools = new Set<AllowancePool>();
  selection.forEach((pool, index) => {
    const path = `/rateSettings/allowancePools/${index}`;
    // Invalid values remain invalid on repetition; only valid pools get duplicate errors.
    if (!PERSONNEL_ALLOWANCE_POOLS.includes(pool)) {
      issues.push({
        code: 'INVALID_ALLOWANCE_POOL',
        path,
        message:
          'Select only LOCAL, ARP, HQ or OTHER for the personnel allowance.',
      });
    } else if (seenPools.has(pool)) {
      issues.push({
        code: 'DUPLICATE_ALLOWANCE_POOL',
        path,
        message: 'Each personnel pool can be selected only once.',
      });
    }
    seenPools.add(pool);
  });
  return issues;
}

/** Validates historical individual selections against internal resources in the snapshot. */
function validateAllowanceResourceTypeIds(
  selection: string[],
  resources: ResourceType[],
): AllowanceSelectionIssue[] {
  if (!Array.isArray(selection)) {
    return [
      {
        code: 'INVALID_ALLOWANCE_SELECTION',
        path: '/rateSettings/allowanceResourceTypeIds',
        message:
          'Personnel allowance selection must be an array of RE Type IDs.',
      },
    ];
  }

  const issues: AllowanceSelectionIssue[] = [];
  const seenIds = new Set<string>();
  selection.forEach((id, index) => {
    const path = `/rateSettings/allowanceResourceTypeIds/${index}`;
    // Inactive captured resources remain valid; subcontract and missing IDs do not.
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      !resources.some(
        (resource) => resource.id === id && resource.category === 'internal',
      )
    ) {
      issues.push({
        code: 'INVALID_ALLOWANCE_RESOURCE',
        path,
        message:
          'The 3% allowance can only select an internal RE Type captured in this cost version.',
      });
    } else if (seenIds.has(id)) {
      issues.push({
        code: 'DUPLICATE_ALLOWANCE_RESOURCE',
        path,
        message: 'Each RE Type can be selected for the 3% allowance only once.',
      });
    }
    seenIds.add(id);
  });
  return issues;
}

/** Validates the authoritative selection; superseded legacy settings never block a new rate card. */
export function validatePersonnelAllowanceSelection(
  settings: RateSettings,
  resources: ResourceType[],
): AllowanceSelectionIssue[] {
  if (settings.allowancePools !== undefined) {
    return validateAllowancePools(settings.allowancePools);
  }
  if (settings.allowanceResourceTypeIds !== undefined) {
    return validateAllowanceResourceTypeIds(
      settings.allowanceResourceTypeIds,
      resources,
    );
  }
  return [];
}
