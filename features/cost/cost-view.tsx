/** Cost workspace composition: versions, inputs, summaries, comparison, and export. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AdditionalTravelTable } from '@/features/cost/components/additional-travel-table';
import { CostInputSheet } from '@/features/cost/components/cost-input-sheet';
import { SubcontractCostSheet } from '@/features/cost/components/subcontract-cost-sheet';
import {
  emptySubcontractCost,
  subcontractCostDetails,
  type SubcontractCost,
} from '@/features/cost/subcontract-domain';
import type { SubcontractItem } from '@/features/master-data/types';
import { BusinessUnitsProvider } from '@/features/master-data/business-unit-select';
import type { BusinessUnitOption } from '@/features/master-data/business-units';
import { HQTravelPanel } from '@/features/cost/components/hq-travel-panel';
import { RateAssumptions } from '@/features/cost/components/rate-assumptions';
import { CostSummaryView } from '@/features/cost/cost-summary-view';
import { VersionComparisonView } from '@/features/cost/version-comparison-view';
import { buildCostExportSnapshot } from '@/features/cost/build-export-snapshot';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { useCostWorkbookExport } from '@/features/cost/use-cost-workbook-export';
import { usePersonnelTableView } from '@/features/cost/use-personnel-table-view';
import {
  getCostStatementValues,
  getActualYears,
  getHQTravelSummary,
  type CostInputRow,
  type CostVersionState,
  type CostVersionSnapshot,
  type ManualCostInputs,
  type RateSettings,
  type ResourceType,
  type TravelSettings,
} from '@/features/cost/domain';
import type { TravelCostRow } from '@/features/cost/additional-travel-domain';
import type { CostViewKey } from '@/features/cost/ui-types';
import { ContextBand } from '@/features/projects/project-context-band';
import { formatSgd } from '@/lib/formatters';

/** Compose the current version's cost inputs, summaries and export controls. */
export function CostView({
  businessUnits = [],
  lockedReason = null,
  versionLockReasons = {},
  versionDeletionReasons = {},
  onDeleteVersion,
  activeVersion,
  versions,
  onSelectVersion,
  onUpdateVersionState,
  costView,
  setCostView,
  rows,
  setRows,
  canEditCost,
  onSave,
  onRegisterSave,
  subcontractCost,
  onSubcontractCostChange,
  subcontractCatalog = [],
  onRefreshSubcontractCatalog,
  rateSettings,
  setRateSettings,
  resourceTypes,
  onApplyMasterRates,
  travelSettings,
  setTravelSettings,
  travelRows,
  setTravelRows,
  travelUplift,
  setTravelUplift,
  manualCosts,
  setManualCosts,
  project,
  proposalNumber,
  onProposalNumberChange,
  announce,
}: {
  businessUnits?: BusinessUnitOption[];
  lockedReason?: string | null;
  versionLockReasons?: Record<string, string>;
  versionDeletionReasons?: Record<string, string>;
  onDeleteVersion?: (version: string) => void;
  activeVersion: string;
  versions: CostVersionSnapshot[];
  onSelectVersion: (version: string, view?: CostViewKey) => void;
  onUpdateVersionState: (version: string, state: CostVersionState) => void;
  costView: CostViewKey;
  setCostView: (view: CostViewKey) => void;
  rows: CostInputRow[];
  setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>>;
  canEditCost?: () => boolean;
  onSave?: () => Promise<boolean>;
  onRegisterSave?: (handler: (() => Promise<boolean>) | null) => void;
  subcontractCost?: SubcontractCost;
  onSubcontractCostChange?: (value: SubcontractCost) => void;
  subcontractCatalog?: SubcontractItem[];
  onRefreshSubcontractCatalog?: () => Promise<SubcontractItem[]>;
  rateSettings: RateSettings;
  setRateSettings: React.Dispatch<React.SetStateAction<RateSettings>>;
  resourceTypes: ResourceType[];
  onApplyMasterRates: () => void;
  travelSettings: TravelSettings;
  setTravelSettings: React.Dispatch<React.SetStateAction<TravelSettings>>;
  travelRows: TravelCostRow[];
  setTravelRows: React.Dispatch<React.SetStateAction<TravelCostRow[]>>;
  travelUplift: number;
  setTravelUplift: (value: number) => void;
  manualCosts: ManualCostInputs;
  setManualCosts: React.Dispatch<React.SetStateAction<ManualCostInputs>>;
  project: CostExportSnapshot['project'];
  proposalNumber?: string;
  onProposalNumberChange?: (value: string) => void;
  announce: (message: string) => void;
}) {
  const personnelTableView = usePersonnelTableView(
    `${project.id}:${activeVersion}`,
  );
  const saveInFlight = useRef(false);
  const [isSavingConfiguration, setSavingConfiguration] = useState(false);
  const [versionDetailsOpen, setVersionDetailsOpen] = useState(false);
  const saveConfiguration = useCallback(async () => {
    if (!personnelTableView.ready || saveInFlight.current) return false;
    saveInFlight.current = true;
    setSavingConfiguration(true);
    try {
      if (onSave && !(await onSave())) {
        announce(
          'Cost was not saved. Resolve the save status or conflict and try again.',
        );
        return false;
      }
      if (!personnelTableView.saveView()) {
        announce(
          'Cost data is saved, but this browser could not save the display configuration.',
        );
        return false;
      }
      announce(
        'Cost and view configuration saved. Refresh will restore the selected year, groups and columns.',
      );
      return true;
    } catch (error) {
      announce(
        `Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    } finally {
      saveInFlight.current = false;
      setSavingConfiguration(false);
    }
  }, [announce, onSave, personnelTableView]);
  useEffect(() => {
    onRegisterSave?.(saveConfiguration);
    return () => onRegisterSave?.(null);
  }, [onRegisterSave, saveConfiguration]);
  // Browsing remains available; only cost writers are guarded by this version's lock.
  const writeIfUnlocked =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      if (!lockedReason) setter(value);
    };
  const version =
    versions.find((item) => item.code === activeVersion) || versions[0];
  /** Latest means the highest numeric V-code, independent of array order. */
  const latestVersion = versions.reduce((latest, item) => {
    const itemNumber = Number(item.code.replace(/^V/, ''));
    const latestNumber = Number(latest.replace(/^V/, ''));
    return itemNumber > latestNumber ? item.code : latest;
  }, activeVersion);
  const hqTravelCost = getHQTravelSummary(
    rows,
    resourceTypes,
    travelSettings,
  ).totalCost;
  const includedTravelCost = hqTravelCost;
  const liveVersionTotal = formatSgd(
    getCostStatementValues(
      rows,
      resourceTypes,
      hqTravelCost,
      manualCosts,
      subcontractCost,
    ).totalWithRisk,
  );
  const actualYears = getActualYears(rateSettings);
  const completenessChecks = [
    ...rows.flatMap((row) => [
      Boolean(row.scope.trim()),
      Boolean(row.bu.trim()),
      Boolean(row.reTypeId.trim()),
      resourceTypes.find((resource) => resource.id === row.reTypeId)
        ?.category === 'subcontract' ||
        row.inputMode === 'mandays' ||
        row.mdPerSite > 0,
      row.years.some(
        (year) => year.sites > 0 || (year.mandays ?? 0) > 0 || year.cost > 0,
      ),
    ]),
    ...subcontractCostDetails(subcontractCost).flatMap((line) => [
      Boolean(line.description.trim() && line.code.trim()),
      Boolean(line.bu.trim()),
      Boolean(line.unit.trim()),
      line.unitPrice !== null && Number.isFinite(line.unitPrice),
      line.quantities.some((qty) => qty > 0),
    ]),
  ];
  const inputCompleteness = completenessChecks.length
    ? Math.round(
        (100 * completenessChecks.filter(Boolean).length) /
          completenessChecks.length,
      )
    : 0;
  const representativeRate =
    resourceTypes.find((item) => item.active && item.category === 'internal') ||
    resourceTypes[0];

  /** Calculates a saved version with its own rates, travel, and manual costs. */
  const versionTotal = (item: CostVersionSnapshot) => {
    if (item.code === activeVersion) return liveVersionTotal;
    const travel = getHQTravelSummary(
      item.costRows,
      item.resourceTypes || resourceTypes,
      item.travelSettings,
    ).totalCost;
    return formatSgd(
      getCostStatementValues(
        item.costRows,
        item.resourceTypes || resourceTypes,
        travel,
        item.manualCosts,
        item.subcontractCost,
      ).totalWithRisk,
    );
  };
  const { isExporting, exportWorkbook, exportSimpleWorkbook } =
    useCostWorkbookExport({
      enabled: Boolean(version),
      simpleLayoutReady: personnelTableView.columnSettings.ready,
      createSimpleLayout: () => personnelTableView.layout,
      announce,
      createSnapshot: () =>
        buildCostExportSnapshot({
          activeVersion,
          versionStatus: version?.state || 'Draft',
          project,
          rateSettings,
          travelSettings,
          resourceTypes,
          rows,
          manualCosts,
          subcontractCost,
        }),
    });

  const content = (
    <div className="wb-page-stack min-w-0 gap-2">
      {lockedReason && (
        <output className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          {lockedReason} 可查看和导出。
        </output>
      )}
      <ContextBand
        project={project}
        proposalNumber={proposalNumber}
        onProposalNumberChange={onProposalNumberChange}
        costVersion={activeVersion}
        latestCostVersion={latestVersion}
        versionStatus={version?.state || 'Draft'}
      />
      {version?.calculationNote ? (
        <output className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          {version.calculationNote}
        </output>
      ) : null}
      {/* A single wrapping strip keeps version selection, status and totals in view. */}
      <section
        className="wb-panel flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 sm:gap-x-4"
        aria-label="Cost version information"
      >
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Version</span>
          <select
            aria-label="View cost version"
            className="h-7 w-28 rounded-md border border-input bg-card px-2 text-[11px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
            value={activeVersion}
            disabled={!versions.length}
            onChange={(event) => onSelectVersion(event.target.value, costView)}
          >
            {versions.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.state}
              </option>
            ))}
          </select>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            {version?.sourceVersion
              ? `from ${version.sourceVersion}`
              : 'Initial version'}
          </span>
        </div>
        <div
          className="flex items-center gap-1.5 text-[11px]"
          title={`Confirmation locks Cost ${activeVersion} only.`}
        >
          <span className="text-muted-foreground">Status</span>
          <select
            aria-label="Current version status"
            className="h-7 w-28 rounded-md border border-input bg-card px-2 text-[11px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:bg-muted/40 disabled:opacity-60"
            value={version?.state || 'Draft'}
            disabled={!version || version.state === 'Confirmed'}
            onChange={(event) => {
              const state = event.target.value as CostVersionState;
              if (
                version &&
                version.state !== 'Confirmed' &&
                (!lockedReason || state === 'Confirmed')
              )
                onUpdateVersionState(activeVersion, state);
            }}
          >
            <option value="Draft" disabled={!!lockedReason}>
              Draft
            </option>
            <option value="Suspended" disabled={!!lockedReason}>
              Suspended
            </option>
            <option value="Confirmed">Confirmed</option>
          </select>
          {version?.state === 'Suspended' && onDeleteVersion ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-destructive"
              disabled={!!versionDeletionReasons[activeVersion]}
              title={
                versionDeletionReasons[activeVersion]
                  ? 'This version is not eligible for deletion.'
                  : 'Delete this suspended version and retain its history.'
              }
              onClick={() => onDeleteVersion(activeVersion)}
            >
              Delete Version
            </Button>
          ) : null}
        </div>
        <div className="flex items-baseline gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Version Total</span>
          <strong className="financial-numeral text-sm font-semibold text-primary">
            {version ? versionTotal(version) : formatSgd(0)}
          </strong>
        </div>
        <div
          className="flex items-center gap-1.5 text-[11px]"
          aria-label="Input Completeness"
        >
          <span className="text-muted-foreground">Complete</span>
          <span className="financial-numeral font-semibold">
            {inputCompleteness}%
          </span>
          <Progress
            value={inputCompleteness}
            className="hidden h-1 w-10 sm:flex [&_[data-slot=progress-indicator]]:bg-primary"
          />
        </div>
        {/* Keep the editing strip short on phones; secondary basis details open explicitly. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-1.5 text-[11px] sm:hidden"
          aria-label="Cost version details"
          aria-expanded={versionDetailsOpen}
          aria-controls="cost-version-details"
          onClick={() => setVersionDetailsOpen(!versionDetailsOpen)}
        >
          Details
        </Button>
        <div
          id="cost-version-details"
          className={`${versionDetailsOpen ? 'flex' : 'hidden'} ml-auto basis-full flex-wrap items-center gap-2 text-[11px] sm:flex sm:basis-auto`}
          aria-label="Calculation Basis"
        >
          <span className="text-[10px] text-muted-foreground sm:hidden">
            {version?.sourceVersion
              ? `Cloned from ${version.sourceVersion}`
              : 'Initial version'}
          </span>
          <span
            className="text-muted-foreground"
            title={`${representativeRate?.hoursPerManday || 0}h/day · ${representativeRate?.mandaysPerMonth || 0}d/month`}
          >
            {actualYears[0] ? `FY${String(actualYears[0]).slice(-2)}` : 'FY—'} ·
            SGD
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={!!lockedReason || version?.state !== 'Draft'}
            title={
              lockedReason
                ? 'This cost version is locked. Master Data rates cannot be applied.'
                : version?.state !== 'Draft'
                  ? 'Only Draft versions can apply the latest Master Data rates.'
                  : 'Apply the latest Master Data personnel rates to this Draft and recalculate its costs.'
            }
            onClick={() => {
              if (!lockedReason && version?.state === 'Draft')
                onApplyMasterRates();
            }}
          >
            Apply Master Rates
          </Button>
        </div>
      </section>
      {/* Keep navigation and save/export actions visible when the toolbar wraps. */}
      <div className="wb-panel min-w-0 p-1.5" aria-label="Cost tools">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <fieldset
            className="flex min-w-0 max-w-full flex-wrap gap-0.5 rounded-md bg-muted/40 p-0.5"
            aria-label="Cost views"
          >
            {[
              {
                key: 'input' as CostViewKey,
                label: 'Input Sheet',
                title: 'Input Sheet',
              },
              {
                key: 'subcontract' as CostViewKey,
                label: 'Subcon',
                title: 'Subcontract Cost',
              },
              {
                key: 'summary' as CostViewKey,
                label: 'Summary',
                title: 'Summary',
              },
              {
                key: 'compare' as CostViewKey,
                label: 'Compare',
                title: 'Version Comparison',
              },
            ].map((item) => (
              <Button
                key={item.key}
                variant={costView === item.key ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-2.5 text-[11px]"
                aria-label={item.title}
                aria-pressed={costView === item.key}
                title={item.title}
                onClick={() => setCostView(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </fieldset>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {personnelTableView.isViewDirty && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                View not saved
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => void saveConfiguration()}
              disabled={isSavingConfiguration || !personnelTableView.ready}
              aria-label="Save cost configuration"
              title="Save cost inputs, allowance and travel settings, plus this version's year, grouping and column layout."
            >
              <Save />
              {isSavingConfiguration ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={exportSimpleWorkbook}
              disabled={isExporting || !personnelTableView.columnSettings.ready}
              title="Cost Detail follows the current groups, row order, columns and year view. Summaries include all five years."
            >
              <Download />
              Simple Export
            </Button>
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              variant="outline"
              onClick={exportWorkbook}
              disabled={isExporting}
              aria-label="Export Cost Workbook"
              title="Export Cost Detail and summaries in one workbook"
            >
              <Download />
              {isExporting ? 'Exporting…' : 'Full Export'}
            </Button>
          </div>
        </div>
      </div>
      {costView === 'input' ? (
        <div className="wb-page-stack min-w-0 gap-2">
          <RateAssumptions
            locked={!!lockedReason}
            settings={rateSettings}
            setSettings={writeIfUnlocked(setRateSettings)}
          />
          <CostInputSheet
            projectId={project.id}
            versionCode={activeVersion}
            key={activeVersion}
            tableView={personnelTableView}
            locked={!!lockedReason}
            rows={rows}
            setRows={writeIfUnlocked(setRows)}
            canEditCost={canEditCost}
            rateSettings={rateSettings}
            setRateSettings={writeIfUnlocked(setRateSettings)}
            resourceTypes={resourceTypes}
            includedTravelCost={includedTravelCost}
            announce={announce}
          />
          <HQTravelPanel
            locked={!!lockedReason}
            announce={announce}
            rows={rows}
            resourceTypes={resourceTypes}
            settings={travelSettings}
            setSettings={writeIfUnlocked(setTravelSettings)}
          />
          {travelRows.length > 0 ? (
            <fieldset disabled={!!lockedReason} className="min-w-0">
              <AdditionalTravelTable
                rows={travelRows}
                setRows={writeIfUnlocked(setTravelRows)}
                rateSettings={rateSettings}
                travelUplift={travelUplift}
                setTravelUplift={writeIfUnlocked(setTravelUplift)}
              />
            </fieldset>
          ) : null}
        </div>
      ) : null}
      {costView === 'summary' ? (
        <CostSummaryView
          readOnly={!!lockedReason}
          rows={rows}
          resourceTypes={resourceTypes}
          travelCost={hqTravelCost}
          manualCosts={manualCosts}
          subcontractCost={subcontractCost}
          setManualCosts={writeIfUnlocked(setManualCosts)}
        />
      ) : null}
      {costView === 'subcontract' ? (
        <SubcontractCostSheet
          value={subcontractCost ?? emptySubcontractCost()}
          onChange={writeIfUnlocked((value: SubcontractCost) =>
            onSubcontractCostChange?.(value),
          )}
          catalog={subcontractCatalog}
          actualYears={actualYears}
          lockedReason={lockedReason}
          announce={announce}
          onRefreshCatalog={onRefreshSubcontractCatalog}
          legacyRows={rows.filter(
            (row) =>
              resourceTypes.find((resource) => resource.id === row.reTypeId)
                ?.category === 'subcontract',
          )}
          onRemoveLegacyRow={(id) => {
            if (!lockedReason)
              setRows((current) => current.filter((row) => row.id !== id));
          }}
        />
      ) : null}
      {costView === 'compare' ? (
        <VersionComparisonView
          deletionReasons={versionDeletionReasons}
          onDeleteVersion={onDeleteVersion}
          lockReasons={versionLockReasons}
          versions={versions}
          activeVersion={activeVersion}
          resourceTypes={resourceTypes}
          onSelectVersion={onSelectVersion}
          onUpdateVersionState={onUpdateVersionState}
        />
      ) : null}
    </div>
  );
  // Share the saved directory and lock without copying either into persisted cost data.
  return (
    <BusinessUnitsProvider options={businessUnits} disabled={!!lockedReason}>
      {content}
    </BusinessUnitsProvider>
  );
}
