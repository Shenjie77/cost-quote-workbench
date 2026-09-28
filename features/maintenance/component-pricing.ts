/** Annual component pricing and a non-destructive adapter for legacy monthly BOQs. */
import { roundMoney } from '../cost/domain.ts';
import { allocateMoneyByWeights } from '../quote/profit-share.ts';
import type {
  BoqLine,
  MaintenanceWorkspace,
  MaintenanceQuoteLine,
} from './domain.ts';

/** Retain old fields and archives while exposing their existing price and duration in years. */
export function maintenanceGridDraft(
  data: MaintenanceWorkspace,
  year = new Date().getFullYear(),
): MaintenanceWorkspace {
  return {
    ...data,
    pricingMode: 'components',
    startYear: data.startYear ?? year,
    boq: data.boq.map((row) => ({
      ...row,
      ct: row.ct ?? row.unitAnnualQuote,
      spms: row.spms ?? 0,
      durationYears: row.durationYears ?? data.coverageMonths / 12,
      remark: row.remark ?? row.basis,
    })),
  };
}

/** Empty optional values are represented by zero; supplied numeric values must remain valid. */
export function calculateComponentMaintenance(data: MaintenanceWorkspace) {
  if (
    !Number.isInteger(data.startYear) ||
    data.startYear! < 1900 ||
    data.startYear! > 9999
  )
    throw new TypeError('Enter a valid maintenance start year.');
  if (
    data.boq.length > 1000 ||
    new Set(data.boq.map((row) => row.id)).size !== data.boq.length
  )
    throw new TypeError('Invalid maintenance row IDs or row count.');
  const annual = new Map<number, number>();
  const lines: MaintenanceQuoteLine[] = data.boq.map((row) => {
    const ct = row.ct ?? row.unitAnnualQuote,
      spms = row.spms ?? 0,
      duration = row.durationYears ?? data.coverageMonths / 12;
    if (
      !row.id ||
      [ct, spms].some(
        (amount) =>
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > 1e10 ||
          Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001,
      ) ||
      !Number.isInteger(row.quantity) ||
      row.quantity < 0 ||
      row.quantity > 1e6 ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 100 ||
      data.startYear! + Math.ceil(duration) - 1 > 9999
    )
      throw new TypeError(
        'CT / SPMS must be non-negative prices with up to two decimals; QTY must be a whole number; Duration must be 0–100 years.',
      );
    const unitPrice = roundMoney(ct + spms);
    const quote = roundMoney(unitPrice * row.quantity * duration);
    if (quote > 1e12)
      throw new TypeError('Maintenance amount exceeds supported range');
    const weights = Array.from({ length: Math.ceil(duration) }, (_, index) =>
      Math.min(1, duration - index),
    );
    const amounts = allocateMoneyByWeights(quote, weights);
    amounts.forEach((amount, index) => {
      const year = data.startYear! + index;
      annual.set(year, roundMoney((annual.get(year) ?? 0) + amount));
    });
    // History is a comparison only; no guessed historical cost or mandatory reference is introduced.
    return {
      boq: structuredClone(row),
      annualReferenceQuote: 0,
      annualReferenceCost: 0,
      cost: 0,
      quote,
    };
  });
  const quote = roundMoney(lines.reduce((sum, line) => sum + line.quote, 0));
  if (quote > 1e12)
    throw new TypeError('Maintenance total exceeds supported range');
  return {
    lines,
    cost: 0,
    quote,
    annual: [...annual].map(([year, total]) => ({ year, total })),
  };
}

/** New rows may be left blank; nothing is required solely to enter or save a draft. */
export function newMaintenanceLine(durationYears = 1): BoqLine {
  return {
    id: crypto.randomUUID(),
    model: '',
    quantity: 0,
    ct: 0,
    spms: 0,
    durationYears,
    remark: '',
    serviceLevel: '',
    site: '',
    referenceId: '',
    unitAnnualQuote: 0,
    basis: '',
    source: `Manual BOQ ${crypto.randomUUID()}`,
  };
}
