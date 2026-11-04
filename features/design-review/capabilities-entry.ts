/** Headless capabilities for the compact workbench. Never imports a business page. */
export * from '../cost/personnel-bulk-entry.ts';
export * from '../cost/subcontract-bulk-entry.ts';
export * from '../cost/import-workbook.ts';
export * from '../cost/simple-export-sheets.ts';
export * from '../cost/version-deletion.ts';
export * from '../cost/subcontract-spreadsheet.ts';
export * from '../cost/personnel-columns.ts';
export * from '../cost/personnel-table-layout.ts';
export * from '../cost/cost-lock.ts';
export * from '../maintenance/versions.ts';
export * from '../maintenance/bulk-entry.ts';
export * from '../maintenance/domain.ts';
export * from '../maintenance/import-service-quote.ts';
export * from '../maintenance/component-pricing.ts';
export * from '../cpq/domain.ts';
export * from '../cpq/export-workbook.ts';
export * from '../master-data/bulk-import-model.ts';
export * from '../master-data/bulk-import-workbook.ts';
export * from '../bulk-entry/workbook.ts';
export * from '../ssr/domain.ts';
export * from '../quote/catalog-domain.ts';
export { validateCostExportSnapshot } from '../cost/validation.ts';
export { masterDataTabs } from '../master-data/navigation.ts';
export * from './bulk-adapter.ts';
export { default as workspaceSchema } from '../../schemas/workspace-state.schema.json';
export { default as costSchema } from '../../schemas/cost-export.schema.json';

export * from '../quote/layout-presets.ts';

export {
  captureResourceRates,
  applyCapturedResourceRates,
} from '../master-data/capture.ts';

export { sceneSchema, outputSchema } from '../../server/ai-output-domain.mjs';
