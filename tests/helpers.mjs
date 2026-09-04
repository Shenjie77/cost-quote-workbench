/** Shared valid fixtures built from the same governed defaults as the UI. */
import {
  initialCostRows,
  initialManualCostInputs,
  initialRateSettings,
  initialTravelSettings,
} from '../features/cost/demo-data.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';

export const makeCostSnapshot = () => ({
  schemaVersion: '2.0.0',
  exportedAt: '2026-09-04T01:02:03.000Z',
  project: {
    id: 'PRJ-TEST-001',
    name: 'Test Service Project',
    client: 'Test Client',
    currency: 'SGD',
  },
  costVersion: { code: 'V1', status: 'Draft' },
  rateSettings: structuredClone(initialRateSettings),
  travelSettings: structuredClone(initialTravelSettings),
  resourceTypes: structuredClone(initialResourceTypes),
  costRows: structuredClone(initialCostRows),
  manualCosts: structuredClone(initialManualCostInputs),
});

export const makeCostRequest = () => ({
  apiVersion: 'cost-workbench/v2',
  kind: 'CostSnapshotRequest',
  requestId: 'req_test_cost_v2',
  data: makeCostSnapshot(),
});
