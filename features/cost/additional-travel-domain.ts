/**
 * Experimental non-HQ travel model used only by the optional UI table.
 * It is intentionally separate from the governed cost export contract until
 * those rows are approved for inclusion in cost, CLI, and Excel outputs.
 */

import { getActualYears, roundMoney, type RateSettings } from './domain.ts';

export type TravelTreatment = 'included' | 'reimbursable' | 'excluded';

export type TravelCostRow = {
  id: string;
  scope: string;
  bu: string;
  destination: string;
  expenseType: string;
  unitBasis: string;
  baseUnitRate: number;
  currency: string;
  rateBaseYear: number;
  quantities: number[];
  treatment: TravelTreatment;
};

export const getTravelYearCost = (
  row: TravelCostRow,
  yearIndex: number,
  settings: RateSettings,
  travelUplift: number,
) => {
  const actualYear = getActualYears(settings)[yearIndex] ?? row.rateBaseYear;
  const periods = Math.max(0, actualYear - row.rateBaseYear);
  const unitRate =
    roundMoney(row.baseUnitRate) * Math.pow(1 + travelUplift / 100, periods);
  return roundMoney(Number(row.quantities[yearIndex] || 0) * unitRate);
};

export const getTravelRowTotal = (
  row: TravelCostRow,
  settings: RateSettings,
  travelUplift: number,
) =>
  roundMoney(
    row.quantities.reduce(
      (sum, _quantity, index) =>
        sum + getTravelYearCost(row, index, settings, travelUplift),
      0,
    ),
  );
