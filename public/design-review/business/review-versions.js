export const versionKeys = [
  'rows',
  'groups',
  'resources',
  'rateSettings',
  'travelSettings',
  'manual',
  'subcon',
  'subconRates',
  'siteTypes',
];
export const captureCost = (state) =>
  Object.fromEntries(versionKeys.map((k) => [k, structuredClone(state[k])]));
export const restoreCost = (state, snapshot) => {
  for (const key of versionKeys) state[key] = structuredClone(snapshot[key]);
};
