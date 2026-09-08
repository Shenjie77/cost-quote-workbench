import type { SubcontractCost } from './subcontract-domain.ts';
/**
 * Stable serialized contracts shared by the browser, CLI, JSON Schema, and
 * Excel exporter. Domain calculations intentionally do not depend on these
 * transport fields, which keeps future storage/API migrations isolated.
 */

import type {
  CostInputRow,
  ManualCostInputs,
  RateSettings,
  ResourceType,
  TravelSettings,
} from './domain.ts';

export const COST_EXPORT_SCHEMA_VERSION = '2.0.0' as const;
export const COST_WORKBOOK_CONTRACT_VERSION = '2.0.0' as const;
export const COST_CALCULATION_ENGINE_VERSION = '2.0.0' as const;
export const CLI_ENVELOPE_VERSION = '2.0.0' as const;

/** Immutable input consumed by validation, calculation, and XLSX generation. */
export type CostExportSnapshot = {
  schemaVersion: typeof COST_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  project: {
    id: string;
    name: string;
    client: string;
    currency: 'SGD';
  };
  costVersion: {
    code: string;
    status: string;
  };
  rateSettings: RateSettings;
  travelSettings: TravelSettings;
  resourceTypes: ResourceType[];
  costRows: CostInputRow[];
  manualCosts: ManualCostInputs;
  subcontractCost?: SubcontractCost;
};
