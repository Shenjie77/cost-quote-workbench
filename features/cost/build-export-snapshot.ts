/**
 * Creates the immutable browser-to-export boundary object.
 *
 * Cloning nested arrays is intentional: users may continue editing the React
 * grid while ExcelJS is loading, but one workbook must always represent one
 * internally consistent point-in-time snapshot.
 */

import {
  COST_EXPORT_SCHEMA_VERSION,
  type CostExportSnapshot,
} from '@/features/cost/contracts';
import type {
  CostInputRow,
  ManualCostInputs,
  RateSettings,
  ResourceType,
  TravelSettings,
} from '@/features/cost/domain';

export type BuildCostExportSnapshotInput = {
  activeVersion: string;
  versionStatus: string;
  project: CostExportSnapshot['project'];
  rateSettings: RateSettings;
  travelSettings: TravelSettings;
  resourceTypes: ResourceType[];
  rows: CostInputRow[];
  manualCosts: ManualCostInputs;
  exportedAt?: string;
};

/** Returns a detached, serializable snapshot accepted by web export and CLI. */
export function buildCostExportSnapshot({
  activeVersion,
  versionStatus,
  project,
  rateSettings,
  travelSettings,
  resourceTypes,
  rows,
  manualCosts,
  exportedAt = new Date().toISOString(),
}: BuildCostExportSnapshotInput): CostExportSnapshot {
  return {
    schemaVersion: COST_EXPORT_SCHEMA_VERSION,
    exportedAt,
    project: { ...project },
    costVersion: {
      code: activeVersion,
      status: versionStatus,
    },
    rateSettings: {
      ...rateSettings,
      annualUplifts: [...rateSettings.annualUplifts],
    },
    travelSettings: { ...travelSettings },
    resourceTypes: resourceTypes.map((item) => ({ ...item })),
    costRows: rows.map((row) => ({
      ...row,
      years: row.years.map((year) => ({ ...year })),
    })),
    manualCosts: { ...manualCosts },
  };
}
