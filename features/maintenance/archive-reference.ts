/** Convert locked annual quotes into reusable per-device reference prices, never full-term totals. */
import type { MaintenanceArchive } from './domain.ts';
import type { MaintenancePriceRecord } from '../master-data/domain.ts';
import { roundMoney } from '../cost/domain.ts';
export function maintenanceArchiveReferences(
  archive: MaintenanceArchive,
  project: string,
): MaintenancePriceRecord[] {
  if (archive.pricingMode !== 'components' || archive.deletedAt) return [];
  return archive.lines
    .filter((line) => line.boq.model.trim())
    .map((line, index) => ({
      id: `${archive.id}:${index}`,
      archiveId: archive.id,
      client: archive.client,
      productModel: line.boq.model,
      ct: line.boq.ct ?? line.boq.unitAnnualQuote,
      spms: line.boq.spms ?? 0,
      quotedYear: Number(archive.createdAt.slice(0, 4)),
      project,
      quotedAmount: roundMoney(
        (line.boq.ct ?? line.boq.unitAnnualQuote) + (line.boq.spms ?? 0),
      ),
      quantity: 1,
      coverageMonths: 12,
      costAmount: 0,
      currency: 'SGD',
      quoteDate: archive.createdAt.slice(0, 10),
      outcome: 'Quoted',
      service: 'Annual maintenance',
      serviceLevel: 'Not specified',
      site: 'Not specified',
      source: project || 'Maintenance archive',
    }));
}
