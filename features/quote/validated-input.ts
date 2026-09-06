/** Shared validated customer quotation input for programmatic exports. */
import { assertQuoteDecision, commercialBasisKey } from '../ssr/domain.ts';
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import { getCostStatementValues, getHQTravelSummary } from '../cost/domain.ts';
import { validateCostExportSnapshot } from '../cost/validation.ts';
import { calculatePricing, validatePricingSettings } from './domain.ts';
import { matchesClient } from './catalog-domain.ts';
import type { QuoteWorkbookInput } from './export-quote-workbook.ts';
export function validatedQuoteInput(
  workspace: WorkbenchWorkspace,
  quoteNumber: string,
): QuoteWorkbookInput {
  const version = workspace.costVersions.find(
    (v) => v.code === workspace.activeVersion,
  );
  if (!version || version.state !== 'Confirmed')
    throw new TypeError(
      'Confirm the cost version before quotation export / 请先确认成本版本',
    );
  assertQuoteDecision(
    workspace.ssr
      ? { ...workspace.ssr, commercialBasis: commercialBasisKey(workspace) }
      : undefined,
    version,
  );
  const resources = version.resourceTypes || workspace.resourceTypes;
  const snapshot = {
    schemaVersion: '2.0.0' as const,
    exportedAt: new Date().toISOString(),
    project: workspace.project,
    costVersion: { code: version.code, status: version.state },
    rateSettings: version.rateSettings,
    travelSettings: version.travelSettings,
    resourceTypes: resources,
    costRows: version.costRows,
    manualCosts: version.manualCosts,
  };
  const validation = validateCostExportSnapshot(snapshot);
  const costErrors = validation.filter((issue) => issue.severity === 'error');
  if (costErrors.length)
    throw new TypeError(costErrors.map((e) => e.message).join('; '));
  const total = getCostStatementValues(
    version.costRows,
    resources,
    getHQTravelSummary(version.costRows, resources, version.travelSettings)
      .totalCost,
    version.manualCosts,
  ).totalWithRisk;
  const errors = validatePricingSettings(workspace.pricing, total);
  const template = workspace.quoteTemplates.find(
    (t) => t.id === workspace.selectedQuoteTemplateId,
  );
  if (
    !template?.active ||
    !matchesClient(template.clientPattern, workspace.project.client)
  )
    errors.push('Select an applicable active quotation template');
  if (workspace.quoteAssumptions.some((a) => a.included && !a.text.trim()))
    errors.push('Included assumption text is required');
  if (errors.length) throw new TypeError(errors.join('; '));
  return {
    project: structuredClone(workspace.project),
    quoteNumber,
    costVersion: version.code,
    template: structuredClone(template!),
    assumptions: structuredClone(workspace.quoteAssumptions),
    pricing: calculatePricing(total, workspace.pricing),
  };
}
