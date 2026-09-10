/** Explicit snapshots for new projects. Global maintenance never calls this. */
import { emptyCpq } from '../cpq/domain.ts';
import {
  recalculateCostRows,
  type CostVersionSnapshot,
  type ResourceType,
} from '../cost/domain.ts';
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import type { PricingSettings } from '../quote/domain.ts';
import type { ProfitShareRate } from '../quote/profit-share.ts';

export const capturedMasterFields = {
  resources: 'resourceTypes',
  subcontract: 'subcontractItems',
  supplemental: 'supplementalCostItems',
  maintenance: 'maintenancePriceRecords',
  assumptions: 'assumptionLibrary',
  'quote-templates': 'quoteTemplates',
  workflow: 'processSteps',
  status: 'projectStatusDefinitions',
} as const;

export type MasterCaptureRecord = {
  tab: string;
  revision: number;
  items: unknown[];
  conflicts: { key: string }[];
};

export function assertMasterCapture(record: MasterCaptureRecord) {
  if (record.conflicts.length)
    throw new TypeError(
      `Master Data ${record.tab} has unresolved records: ${record.conflicts.map((c) => c.key).join(', ')}. Resolve them in global Master Data before applying.`,
    );
  return record;
}

/** Pricing snapshots can adopt new commercial terms without changing costs. */
export function captureProfitShareRates(
  pricing: PricingSettings,
  raw: MasterCaptureRecord,
): PricingSettings {
  const master = assertMasterCapture(raw);
  return {
    ...structuredClone(pricing),
    profitShareRates: structuredClone(master.items) as ProfitShareRate[],
    profitShareMasterDataRevision: master.revision,
  };
}

/** The explicit apply action changes one draft; missing references fail atomically. */
export function captureResourceRates(
  version: CostVersionSnapshot,
  raw: MasterCaptureRecord,
): CostVersionSnapshot {
  const master = assertMasterCapture(raw);
  const resources = structuredClone(master.items) as ResourceType[];
  const rateSettings = structuredClone(version.rateSettings);
  if (
    rateSettings.allowancePools === undefined &&
    rateSettings.allowanceResourceTypeIds !== undefined
  )
    rateSettings.allowanceResourceTypeIds =
      rateSettings.allowanceResourceTypeIds.map((id) => {
        const old = version.resourceTypes?.find(
          (resource) => resource.id === id,
        );
        const target = old
          ? resources.find((resource) => resource.code === old.code)
          : resources.find((resource) => resource.id === id);
        if (!target || target.category !== 'internal')
          throw new TypeError(
            `Allowance RE Type ${old?.code || id} is missing or no longer personnel in global Master Data. Update the version's allowance selection before applying rates.`,
          );
        return target.id;
      });
  const rows = version.costRows.map((row) => {
    const old = version.resourceTypes?.find((item) => item.id === row.reTypeId);
    const target = old
      ? resources.find((item) => item.code === old.code)
      : resources.find((item) => item.id === row.reTypeId);
    if (!target)
      throw new TypeError(
        `RE Type ${old?.code || row.reTypeId} is missing from global Master Data. Resolve the rate reference before applying.`,
      );
    return { ...structuredClone(row), reTypeId: target.id };
  });
  return {
    ...structuredClone(version),
    resourceTypes: resources,
    rateSettings,
    costRows: recalculateCostRows(rows, resources, rateSettings),
    masterDataRevision: master.revision,
  };
}

/** Keep the active editors and their named version on the same captured rate basis. */
export function applyCapturedResourceRates(
  workspace: WorkbenchWorkspace,
  updatedVersion: CostVersionSnapshot,
): WorkbenchWorkspace {
  if (
    !workspace.costVersions.some(
      (version) => version.code === updatedVersion.code,
    )
  )
    throw new TypeError(`Cost version ${updatedVersion.code} does not exist.`);
  const captured = structuredClone(updatedVersion);
  return {
    ...workspace,
    costVersions: workspace.costVersions.map((version) =>
      version.code === captured.code ? captured : version,
    ),
    ...(workspace.activeVersion === captured.code
      ? {
          costRows: structuredClone(captured.costRows),
          rateSettings: structuredClone(captured.rateSettings),
        }
      : {}),
  };
}

export function captureGlobalMasterData(
  workspace: WorkbenchWorkspace,
  records: MasterCaptureRecord[],
): WorkbenchWorkspace {
  const next = structuredClone(workspace);
  next.masterDataRevisions = {};
  for (const raw of records) {
    const record = assertMasterCapture(raw);
    const field =
      capturedMasterFields[record.tab as keyof typeof capturedMasterFields];
    if (field) Object.assign(next, { [field]: structuredClone(record.items) });
    else if (record.tab === 'profit-share') {
      next.pricing = captureProfitShareRates(next.pricing, record);
    } else if (record.tab === 'cpq-catalog') {
      next.cpq = {
        catalog: structuredClone(record.items) as NonNullable<
          WorkbenchWorkspace['cpq']
        >['catalog'],
        draft: { ...emptyCpq().draft, costVersion: 'V1' },
        archives: [],
      };
    }
    next.masterDataRevisions[record.tab] = record.revision;
  }
  next.processSteps = next.processSteps.map((step, index) => ({
    ...step,
    no: String(index + 1).padStart(2, '0'),
    state: 'not_started',
    tone: 'gray',
    date: '',
    dateZh: '',
    input: '',
    inputZh: '',
  }));
  next.selectedStep = 0;
  next.currentWorkflowStepCode = next.processSteps[0]?.code || '';
  next.projectStatus =
    next.projectStatusDefinitions.find(
      (s) => s.code === 'input_preparation' && s.active,
    )?.code ||
    next.projectStatusDefinitions.find((s) => s.active)?.code ||
    '';
  if (!next.projectStatus)
    throw new TypeError(
      'Global Master Data needs an active project status before creating a project.',
    );
  next.selectedQuoteTemplateId =
    next.quoteTemplates.find((t) => t.active)?.id ||
    next.quoteTemplates[0]?.id ||
    '';
  if (!next.selectedQuoteTemplateId)
    throw new TypeError(
      'Global Master Data needs a quotation template before creating a project.',
    );
  next.reviewGates = [];
  next.quoteAssumptions = [];
  return next;
}
