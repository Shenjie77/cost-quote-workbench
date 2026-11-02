import { Badge } from '@/components/ui/badge';
import { Surface, Text } from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
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
import { SimpleCostExportDialog } from '@/features/cost/components/simple-cost-export-dialog';
import { usePersonnelTableView } from '@/features/cost/use-personnel-table-view';
import {
  getY1Year,
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
import {
  ContextBand,
  type ProjectContextActions,
} from '@/features/projects/project-context-band';
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
  projectContext,
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
  projectContext?: ProjectContextActions;
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
      getY1Year(rateSettings),
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
    ...subcontractCostDetails(subcontractCost, getY1Year(rateSettings)).flatMap(
      (line) => [
        Boolean(line.description.trim() && line.code.trim()),
        Boolean(line.bu.trim()),
        Boolean(line.unit.trim()),
        line.unitPrice !== null && Number.isFinite(line.unitPrice),
        line.quantities.some((qty) => qty > 0),
      ],
    ),
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
        getY1Year(item.rateSettings),
      ).totalWithRisk,
    );
  };
  const {
    isExporting,
    getSimpleWorkbookSheets,
    exportWorkbook,
    exportSimpleWorkbook,
  } = useCostWorkbookExport({
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

  const renderCostTools = (viewControls?: React.ReactNode) => (
    <Surface
      as="div"
      variant="toolbar"
      className="min-w-0"
      aria-label="Cost tools"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <Surface
          as="fieldset"
          variant="control-group"
          className="min-w-0 max-w-full"
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

              aria-label={item.title}
              aria-pressed={costView === item.key}
              title={item.title}
              onClick={() => setCostView(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </Surface>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {personnelTableView.isViewDirty && (
            <Badge tone="warning">View not saved</Badge>
          )}
          <Button
            size="sm"
            variant="outline"

            onClick={() => void saveConfiguration()}
            disabled={isSavingConfiguration || !personnelTableView.ready}
            aria-label="Save cost configuration"
            title="Save cost inputs, allowance and travel settings, plus this version's year, grouping and column layout."
          >
            <Save />
            {isSavingConfiguration ? 'Saving…' : 'Save'}
          </Button>
          <SimpleCostExportDialog
            key={`${project.id}:${activeVersion}`}
            disabled={
              isExporting ||
              !version ||
              !personnelTableView.columnSettings.ready
            }
            getSheets={getSimpleWorkbookSheets}
            onExport={exportSimpleWorkbook}
          />
          <Button
            size="sm"

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
        {viewControls}
      </div>
    </Surface>
  );

  const content = (
    <Surface as="div" variant="page" className="min-w-0">
      {lockedReason && (
        <Surface
          as="output"
          variant="notice"
          tone="warning"
          textRole="body-main"
          className="block"
        >
          {lockedReason} 可查看和导出。
        </Surface>
      )}
      <ContextBand
        {...projectContext}
        project={project}
        proposalNumber={proposalNumber}
        onProposalNumberChange={onProposalNumberChange}
        costVersion={activeVersion}
        latestCostVersion={latestVersion}
        versionStatus={version?.state || 'Draft'}
      />
      {version?.calculationNote ? (
        <Surface
          as="output"
          variant="notice"
          tone="warning"
          textRole="body-small"
          className="block"
        >
          {version.calculationNote}
        </Surface>
      ) : null}
      {/* A single wrapping strip keeps version selection, status and totals in view. */}
      <Surface
        as="section"
        variant="toolbar"
        className="min-w-0 sm:gap-x-4"
        aria-label="Cost version information"
      >
        <Surface
          as="div"
          textRole="body-small"
          className="flex items-center gap-2"
        >
          <Text as="span" tone="muted">
            Version
          </Text>
          <SelectField
            aria-label="View cost version"
            title={
              version?.sourceVersion
                ? `From ${version.sourceVersion}`
                : 'Initial version'
            }
            className="h-8 w-28"
            value={activeVersion}
            disabled={!versions.length}
            onChange={(event) => onSelectVersion(event.target.value, costView)}
          >
            {versions.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} · {item.state}
              </option>
            ))}
          </SelectField>
        </Surface>
        <Surface
          as="div"
          textRole="body-small"
          className="flex items-center gap-2"
          title={`Confirmation locks Cost ${activeVersion} only.`}
        >
          <Text as="span" tone="muted">
            Status
          </Text>
          <SelectField
            aria-label="Current version status"
            className="h-8 w-28"
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
          </SelectField>
          {version?.state === 'Suspended' && onDeleteVersion ? (
            <Button
              size="sm"
              variant="ghost"

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
        </Surface>
        <Surface
          as="div"
          textRole="body-small"
          className="flex items-baseline gap-2"
        >
          <Text as="span" tone="muted">
            Version Total
          </Text>
          <Text
            as="strong"
            tone="primary"
            textRole="body-main"
            className="financial-numeral"
          >
            {version ? versionTotal(version) : formatSgd(0)}
          </Text>
        </Surface>
        <Surface
          as="div"
          textRole="body-small"
          className="flex items-center gap-2"
          aria-label="Input Completeness"
        >
          <Text as="span" tone="muted">
            Complete
          </Text>
          <span className="financial-numeral">{inputCompleteness}%</span>
          <Progress
            value={inputCompleteness}
            className="hidden h-1 w-10 sm:flex"
          />
        </Surface>
        {/* Keep the editing strip short on phones; secondary basis details open explicitly. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="sm:hidden"
          aria-label="Cost version details"
          aria-expanded={versionDetailsOpen}
          aria-controls="cost-version-details"
          onClick={() => setVersionDetailsOpen(!versionDetailsOpen)}
        >
          Details
        </Button>
        <Surface
          id="cost-version-details"
          as="div"
          variant={'plain'}
          tone={'inherit'}
          textRole="body-small"
          className={`${versionDetailsOpen ? 'flex' : 'hidden'} ml-auto basis-full flex-wrap items-center gap-2 sm:flex sm:basis-auto `}
          aria-label="Calculation Basis"
        >
          <Text
            as="span"
            tone="muted"
            textRole="body-small"
            className="sm:hidden"
          >
            {version?.sourceVersion
              ? `Cloned from ${version.sourceVersion}`
              : 'Initial version'}
          </Text>
          <Text
            as="span"
            tone="muted"
            title={`${representativeRate?.hoursPerManday || 0}h/day · ${representativeRate?.mandaysPerMonth || 0}d/month`}
          >
            {actualYears[0] ? `FY${String(actualYears[0]).slice(-2)}` : 'FY—'} ·
            SGD
          </Text>
          <Button
            size="sm"
            variant="outline"

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
        </Surface>
      </Surface>
      {costView !== 'input' && renderCostTools()}
      {costView === 'input' ? (
        <Surface as="div" variant="page" className="min-w-0">
          <RateAssumptions
            locked={!!lockedReason}
            settings={rateSettings}
            setSettings={writeIfUnlocked(setRateSettings)}
          />
          <CostInputSheet
            renderNavigation={renderCostTools}
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
            travelSettings={travelSettings}
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
        </Surface>
      ) : null}
      {costView === 'summary' ? (
        <CostSummaryView
          readOnly={!!lockedReason}
          rows={rows}
          resourceTypes={resourceTypes}
          travelCost={hqTravelCost}
          travelSettings={travelSettings}
          manualCosts={manualCosts}
          subcontractCost={subcontractCost}
          subcontractStartYear={getY1Year(rateSettings)}
          setManualCosts={writeIfUnlocked(setManualCosts)}
        />
      ) : null}
      {costView === 'subcontract' ? (
        <SubcontractCostSheet
          key={`${project.id}:${activeVersion}`}
          workspaceKey={`subcontract:${project.id}:${activeVersion}`}
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
    </Surface>
  );
  // Share the saved directory and lock without copying either into persisted cost data.
  return (
    <BusinessUnitsProvider options={businessUnits} disabled={!!lockedReason}>
      {content}
    </BusinessUnitsProvider>
  );
}
