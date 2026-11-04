/** Headless exporters for the approved compact UI. No page components are imported. */
import {
  buildSimpleCostWorkbookBytes,
  getSimpleCostWorkbookFileName,
} from '../cost/export-simple-workbook';
import { buildQuoteWorkbookBuffer } from '../quote/export-quote-workbook';
import { calculatePricing } from '../quote/domain';
import { calculateBuCostAllocation } from '../quote/profit-share';
import { buildQuoteLines } from '../quote/quote-lines';
import { quotationProjectName } from '../quote/template-text';
import { quoteFieldValues } from '../quote/document-fields';
import { customerDocument } from '../quote/customer-document';
import {
  buildCostStatementRows,
  getHQTravelSummary,
  getY1Year,
} from '../cost/domain';
import type { CostExportSnapshot } from '../cost/contracts';
import {
  buildCostWorkbookBytes,
  getCostWorkbookFileName,
} from '../cost/export-workbook';
import { buildCombinedQuoteWorkbookBytes } from '../quote/export-combined-workbook';
import { validateCostExportSnapshot } from '../cost/validation';
import { assertQuoteDecision } from '../ssr/domain';
import { quoteProfitShareSnapshot } from '../quote/history-record';
import type { PersonnelTableLayout } from '../cost/personnel-table-layout';
import type { SimpleCostSheetId } from '../cost/simple-export-sheets';
import type { WorkbenchWorkspace } from '../workbench/workspace-types';
export async function costOutput(
  snapshot: CostExportSnapshot,
  options: {
    full?: boolean;
    layout?: PersonnelTableLayout;
    sheets?: SimpleCostSheetId[];
  } = {},
) {
  return {
    bytes: options.full
      ? await buildCostWorkbookBytes(snapshot)
      : await buildSimpleCostWorkbookBytes(
          snapshot,
          options.layout,
          options.sheets,
        ),
    fileName: options.full
      ? getCostWorkbookFileName(snapshot)
      : getSimpleCostWorkbookFileName(snapshot),
  };
}
export async function quoteOutput(
  w: WorkbenchWorkspace,
  snapshot: CostExportSnapshot,
  options: {
    status?: 'Draft' | 'Final';
    layout?: 'customer' | 'template' | 'combined';
    templateBytes?: Uint8Array;
    personnelLayout?: PersonnelTableLayout;
    sheets?: SimpleCostSheetId[];
  } = {},
) {
  const issues = validateCostExportSnapshot(snapshot).filter(
    (i) => i.severity === 'error',
  );
  if (issues.length) throw new Error(issues.map((i) => i.message).join('; '));
  const status = options.status || 'Draft';
  if (status === 'Final') {
    const version = w.costVersions.find((v) => v.code === w.activeVersion)!;
    if (version.state !== 'Confirmed')
      throw new Error(
        '请先确认成本版本 / Confirm cost before final quotation.',
      );
    if (w.workflowMode !== 'project') assertQuoteDecision(w.ssr, version);
  }
  if (options.layout === 'combined' && w.workflowMode !== 'project')
    assertQuoteDecision(
      w.ssr,
      w.costVersions.find((v) => v.code === w.activeVersion)!,
    );
  if (options.layout === 'combined')
    return {
      bytes: await buildCombinedQuoteWorkbookBytes({
        costSnapshot: snapshot,
        pricing: w.pricing,
        maintenance: w.maintenanceBoq,
        selectedSheets: options.sheets,
        personnelLayout: options.personnelLayout,
      }),
      fileName: `Internal_Quote_${Date.now()}.xlsx`,
    };
  const travel = getHQTravelSummary(
    snapshot.costRows,
    snapshot.resourceTypes,
    snapshot.travelSettings,
  );
  const total = buildCostStatementRows(
    snapshot.costRows,
    snapshot.resourceTypes,
    travel.totalCost,
    snapshot.manualCosts,
    snapshot.subcontractCost,
    getY1Year(snapshot.rateSettings),
  ).at(-1)!.amount;
  const pricing = calculatePricing(
    total,
    { ...w.pricing, gstPercent: 0 },
    calculateBuCostAllocation(snapshot),
    snapshot,
  );
  const template = w.quoteTemplates.find(
    (t) => t.id === w.selectedQuoteTemplateId,
  );
  if (!template) throw new Error('Select a quotation template.');
  const lines = buildQuoteLines(
    snapshot,
    w.pricing.lineMode || 'single',
    pricing.listPrice,
    pricing.allocatedManualLines ?? w.pricing.manualLines,
  );
  const generatedAt = new Date().toISOString(),
    quoteNumber = `${w.ssr?.proposalNumber || w.project.id}-${w.activeVersion}-${Date.now()}`;
  const input = {
    project: w.project,
    quoteNumber,
    costVersion: w.activeVersion,
    template,
    assumptions: w.quoteAssumptions,
    pricing,
    lines,
    lineMode: w.pricing.lineMode,
    maintenance: w.maintenanceBoq,
    documentStatus: status,
    ...((options.layout || 'customer') === 'customer'
      ? { layout: 'customer' as const }
      : {}),
    lineRemarks: w.pricing.lineRemarks,
    profitShareMasterDataRevision: w.pricing.profitShareMasterDataRevision,
    issuedAt: generatedAt,
  };
  const document = customerDocument(input);
  const bytes = await buildQuoteWorkbookBuffer(input, options.templateBytes);
  const fileName = `Quotation_${status.toUpperCase()}_${w.project.id.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.xlsx`;
  return {
    bytes,
    fileName,
    history: {
      id: crypto.randomUUID(),
      quoteNumber,
      generatedAt,
      costVersion: w.activeVersion,
      templateId: template.id,
      status,
      profitShareSnapshot: quoteProfitShareSnapshot(
        pricing,
        w.pricing.profitShareMasterDataRevision,
      ),
      costAmount: pricing.cost,
      quoteBeforeTax: pricing.quoteBeforeTax,
      gstAmount: 0,
      quoteAfterTax: pricing.quoteAfterTax,
      grossMarginPercent: pricing.grossMarginPercent,
      note: `Generated ${fileName}`,
      customerQuoteAmount: document.total,
      customerOptionalAmount: document.optionalAmount,
      quotationProjectName: quotationProjectName(input),
      discountDescription: w.pricing.discountDescription || '',
      templateSnapshot: {
        ...structuredClone(template),
        termsAndConditions: String(
          quoteFieldValues(input).termsAndConditions ?? '',
        ),
      },
      assumptionSnapshots: structuredClone(
        w.quoteAssumptions.filter((a) => a.included),
      ),
      lineSnapshots: structuredClone(document.service),
      lineMode: w.pricing.lineMode,
      discountAllocationSnapshot: document.allocation,
      lineRemarks: structuredClone(w.pricing.lineRemarks || {}),
      maintenanceLineSnapshots: document.maintenance,
    },
  };
}
