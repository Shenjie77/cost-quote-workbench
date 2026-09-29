/** Maintenance versions are independent of service-cost versions; the active draft stays at the existing workspace boundary. */
import type { MaintenanceWorkspace, BoqLine } from './domain.ts';
export type MaintenanceVersion = {
  code: string;
  coverageMonths: number;
  boq: BoqLine[];
  pricingMode?: 'components';
  startYear?: number;
};
export const maintenanceVersionCode = (data: MaintenanceWorkspace) =>
  data.versionCode ?? 'MV1';
/** Capture only editable draft fields; immutable archives remain shared across all versions. */
function snapshot(data: MaintenanceWorkspace): MaintenanceVersion {
  return structuredClone({
    code: maintenanceVersionCode(data),
    coverageMonths: data.coverageMonths,
    boq: data.boq,
    ...(data.pricingMode ? { pricingMode: data.pricingMode } : {}),
    ...(data.startYear !== undefined ? { startYear: data.startYear } : {}),
  });
}
/** Swap drafts without discarding unsaved work in the version being left. */
export function selectMaintenanceVersion(
  data: MaintenanceWorkspace,
  code: string,
): MaintenanceWorkspace {
  if (code === maintenanceVersionCode(data)) return data;
  const target = data.versions?.find((version) => version.code === code);
  if (!target) throw new Error('Maintenance version not found');
  const { code: versionCode, ...draft } = structuredClone(target);
  return {
    ...data,
    ...draft,
    pricingMode: draft.pricingMode,
    startYear: draft.startYear,
    versionCode,
    versions: [
      ...(data.versions ?? []).filter((version) => version.code !== code),
      snapshot(data),
    ],
  };
}
/** Add a separately editable blank or copied maintenance draft. */
export function createMaintenanceVersion(
  data: MaintenanceWorkspace,
  copy = true,
): MaintenanceWorkspace {
  if ((data.versions?.length ?? 0) >= 99)
    throw new Error('Maximum 100 maintenance versions');
  const numbers = [
    maintenanceVersionCode(data),
    ...(data.versions ?? []).map((version) => version.code),
  ].map((code) => Number(code.slice(2)));
  return {
    ...data,
    versionCode: `MV${Math.max(...numbers) + 1}`,
    boq: copy ? structuredClone(data.boq) : [],
    versions: [...(data.versions ?? []), snapshot(data)],
  };
}
