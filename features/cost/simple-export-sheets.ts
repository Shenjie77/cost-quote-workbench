/** Available page-shaped reports for the captured Simple Cost Export. */
import type { CostExportSnapshot } from './contracts.ts';
import { getY1Year } from './domain.ts';
import { isLegacySubcontractRow } from './personnel-cost-rows.ts';
import type { PersonnelTableLayout } from './personnel-table-layout.ts';
import { subcontractCostDetails } from './subcontract-domain.ts';

export type SimpleCostSheetId =
  | 'Cost Detail'
  | 'Legacy Subcon'
  | 'Subcon Rates'
  | 'Subcon Detail'
  | 'Subcon Site Types'
  | 'Summary Scope'
  | 'Summary BU'
  | 'Summary RE Type'
  | 'Summary Subcon'
  | 'Cost Statement';

export type SimpleCostSheet = {
  id: SimpleCostSheetId;
  label: string;
  description: string;
};

/** Match the existing workbook's sheet order and data-dependent sheet creation. */
export function getAvailableSimpleCostSheets(
  snapshot: CostExportSnapshot,
  layout?: PersonnelTableLayout,
): SimpleCostSheet[] {
  const sheets: SimpleCostSheet[] = [
    {
      id: 'Cost Detail',
      label: 'Cost Detail',
      description: layout
        ? 'Personnel rows using the current columns, grouping and delivery year.'
        : 'All cost rows with five years of quantities and costs.',
    },
  ];

  // A personnel view separates legacy subcontract rows from the detail grid.
  if (
    layout &&
    snapshot.costRows.some((row) =>
      isLegacySubcontractRow(row, snapshot.resourceTypes),
    )
  )
    sheets.push({
      id: 'Legacy Subcon',
      label: 'Legacy Subcon',
      description: 'Historical subcontract rows and their saved annual costs.',
    });

  if (snapshot.subcontractCost?.rateSettings)
    sheets.push({
      id: 'Subcon Rates',
      label: 'Subcon Rates',
      description: 'Subcontract base year, annual uplifts and price factors.',
    });

  // The shared Subcon exporter adds detail and site sheets only when BOQ lines exist.
  const hasSubcontractDetails =
    subcontractCostDetails(
      snapshot.subcontractCost,
      getY1Year(snapshot.rateSettings),
    ).length > 0;
  if (hasSubcontractDetails) {
    sheets.push({
      id: 'Subcon Detail',
      label: 'Subcon Detail',
      description: 'Subcontract BOQ items, unit prices and annual costs.',
    });
    if (
      snapshot.subcontractCost?.mode === 'site-types' &&
      snapshot.subcontractCost.siteTypes.length
    )
      sheets.push({
        id: 'Subcon Site Types',
        label: 'Subcon Site Types',
        description: 'Site deployment quantities and costs by delivery year.',
      });
  }

  sheets.push(
    {
      id: 'Summary Scope',
      label: 'Summary Scope',
      description: 'All-year costs, mandays and shares grouped by scope.',
    },
    {
      id: 'Summary BU',
      label: 'Summary BU',
      description: 'All-year costs, mandays and shares grouped by BU.',
    },
    {
      id: 'Summary RE Type',
      label: 'Summary RE Type',
      description:
        'All-year costs, mandays and shares grouped by resource type.',
    },
    {
      id: 'Summary Subcon',
      label: 'Summary Subcon',
      description:
        'Subcontract costs grouped by scope with BOQ code references.',
    },
    {
      id: 'Cost Statement',
      label: 'Cost Statement',
      description: 'The complete cost statement including risk and totals.',
    },
  );
  return sheets;
}
