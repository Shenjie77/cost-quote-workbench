import { migrateQuoteSections } from './quote-section-settings.ts';
import { allocateQuotationDiscount } from './discount-allocation.ts';
import { quotationProjectName } from './template-text.ts';
import { groupedLines, quotationSections } from './quotation-groups.ts';
import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
import type { QuoteLine } from './excel-template-types.ts';
import {
  calculateComponentMaintenance,
  maintenanceGridDraft,
} from '../maintenance/component-pricing.ts';
import { roundMoney } from '../cost/domain.ts';

/** One customer-visible schedule shared by output validation and the archived snapshot. */
export function customerDocument(input: QuoteWorkbookInput) {
  const service = input.lines?.map((line) =>
    line.id === 'service:project' &&
    (!input.lineMode || input.lineMode === 'single')
      ? { ...line, description: quotationProjectName(input) }
      : line,
  ) ?? [
    {
      id: 'service',
      description: quotationProjectName(input),
      quantity: 1,
      unit: 'per lot',
      unitPrice: input.pricing.listPrice,
      amount: input.pricing.listPrice,
    },
  ];
  const maintenance: QuoteLine[] = input.pricedMaintenanceLines
    ? [...input.pricedMaintenanceLines]
    : [];
  if (input.maintenance && !input.pricedMaintenanceLines) {
    const draft = maintenanceGridDraft(input.maintenance);
    const calculated = calculateComponentMaintenance(draft);
    for (const { boq, quote } of calculated.lines) {
      if (!boq.quantity || !boq.durationYears) continue;
      if (!boq.description?.trim() && !boq.model.trim())
        throw new Error(
          'Enter a description or model for each maintenance item.',
        );
      maintenance.push({
        id: `maintenance:${boq.id}`,
        description:
          boq.description?.trim() ||
          `${boq.model.trim()} (${boq.quantity}${boq.unit?.trim() ? ` ${boq.unit.trim()}` : ''})`,
        unit: 'per year',
        quantity: boq.durationYears!,
        unitPrice: roundMoney(
          ((boq.ct ?? boq.unitAnnualQuote) + (boq.spms ?? 0)) * boq.quantity,
        ),
        amount: quote,
      });
    }
  }
  const maintenanceAmount = roundMoney(
    maintenance.reduce((sum, line) => sum + line.amount, 0),
  );
  const total = roundMoney(input.pricing.quoteBeforeTax + maintenanceAmount);
  if (!Number.isFinite(total) || total > 1e12)
    throw new Error('Customer quotation total exceeds the supported range.');
  const sectionSettings = migrateQuoteSections(input.pricing, input.template);
  const sectionNames = sectionSettings.sectionNames;
  const groupedService = groupedLines(
    service,
    input.pricing.lineGroups,
    sectionNames,
  );
  const groupedMaintenance = groupedLines(
    maintenance,
    input.pricing.lineGroups,
    sectionNames,
  );
  const allLines = [...groupedService, ...groupedMaintenance];
  const allocation = allocateQuotationDiscount(
    allLines,
    input.pricing.discount,
    sectionSettings.discountAllocation,
  );
  if (allocation.errors.length) throw new Error(allocation.errors.join(' '));
  const optionalAmount =
    allocation.mode === 'total'
      ? allocation.optionalGross
      : allocation.optionalNet;
  const mandatoryTotal =
    allocation.mode === 'total'
      ? allocation.mandatoryGross
      : allocation.mandatoryNet;
  const grandTotal = roundMoney(
    allocation.mandatoryGross +
      allocation.optionalGross -
      input.pricing.discount,
  );
  return {
    allocation,
    service: groupedService,
    maintenance: groupedMaintenance,
    maintenanceAmount,
    total: grandTotal,
    mandatoryTotal,
    optionalAmount,
    allLines,
    sections: quotationSections(allLines),
  };
}
