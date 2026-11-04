/** CPQ calculation and archives share the complete persisted cost-version contract. */
export function workspaceCostBaseline(workspace) {
  const version = workspace.costVersions.find(
    (v) => v.code === workspace.activeVersion,
  );
  if (!version) throw new Error('成本版本不存在 / Cost version not found');
  const baseline = structuredClone(version);
  for (const key of [
    'costRows',
    'subcontractCost',
    'rateSettings',
    'travelSettings',
    'travelRows',
    'travelUplift',
    'manualCosts',
  ]) {
    if (workspace[key] !== undefined)
      baseline[key] = structuredClone(workspace[key]);
  }
  baseline.resourceTypes = structuredClone(
    version.resourceTypes || workspace.resourceTypes,
  );
  return baseline;
}
