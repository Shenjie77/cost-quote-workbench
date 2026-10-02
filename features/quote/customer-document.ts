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
  const service = input.lines ?? [
    {
      id: 'service',
      description: input.project.name,
      quantity: 1,
      unit: 'per lot',
      unitPrice: input.pricing.listPrice,
      amount: input.pricing.listPrice,
    },
  ];
  const maintenance: QuoteLine[] = [];
  if (input.maintenance) {
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
          `${boq.model.trim()} (${boq.quantity} node/NE)`,
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
  const groupedService = groupedLines(service, input.pricing.lineGroups);
  const groupedMaintenance = groupedLines(
    maintenance,
    input.pricing.lineGroups,
  );
  const allLines = [...groupedService, ...groupedMaintenance];
  const optionalAmount = roundMoney(
    allLines
      .filter((l) => l.inclusion === 'optional')
      .reduce((sum, l) => sum + l.amount, 0),
  );
  const mandatoryService = groupedService
    .filter((l) => l.inclusion === 'mandatory')
    .reduce((sum, l) => sum + l.amount, 0);
  if (input.pricing.discount > roundMoney(mandatoryService))
    throw new Error(
      'The service discount exceeds the Mandatory service amount.',
    );
  const mandatoryTotal = roundMoney(total - optionalAmount);
  if (mandatoryTotal < 0)
    throw new Error(
      'The service discount exceeds the Mandatory quotation amount.',
    );
  return {
    service: groupedService,
    maintenance: groupedMaintenance,
    maintenanceAmount,
    total: mandatoryTotal,
    optionalAmount,
    allLines,
    sections: quotationSections(allLines),
  };
}
