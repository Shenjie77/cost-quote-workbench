/** Cost workspace composition: versions, inputs, summaries, comparison, and export. */

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BiText } from '@/components/workbench/bilingual-text';
import { AdditionalTravelTable } from '@/features/cost/components/additional-travel-table';
import { CostInputSheet } from '@/features/cost/components/cost-input-sheet';
import { HQTravelPanel } from '@/features/cost/components/hq-travel-panel';
import { RateAssumptions } from '@/features/cost/components/rate-assumptions';
import { CostSummaryView } from '@/features/cost/cost-summary-view';
import { VersionComparisonView } from '@/features/cost/version-comparison-view';
import { buildCostExportSnapshot } from '@/features/cost/build-export-snapshot';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { useCostWorkbookExport } from '@/features/cost/use-cost-workbook-export';
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

export function CostView({
  activeVersion,
  versions,
  onSelectVersion,
  onUpdateVersionState,
  costView,
  setCostView,
  rows,
  setRows,
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
  announce,
}: {
  activeVersion: string;
  versions: CostVersionSnapshot[];
  onSelectVersion: (version: string) => void;
  onUpdateVersionState: (version: string, state: CostVersionState) => void;
  costView: CostViewKey;
  setCostView: (view: CostViewKey) => void;
  rows: CostInputRow[];
  setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>>;
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
  announce: (message: string) => void;
}) {
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
    getCostStatementValues(rows, resourceTypes, hqTravelCost, manualCosts)
      .totalWithRisk,
  );
  const actualYears = getActualYears(rateSettings);
  const inputCompleteness = rows.length
    ? Math.round(
        (rows.reduce(
          (complete, row) =>
            complete +
            Number(Boolean(row.scope.trim())) +
            Number(Boolean(row.bu.trim())) +
            Number(Boolean(row.reTypeId.trim())) +
            Number(row.inputMode === 'mandays' || row.mdPerSite > 0) +
            Number(row.years.some((year) => year.sites > 0 || year.cost > 0)),
          0,
        ) /
          (rows.length * 5)) *
          100,
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
      ).totalWithRisk,
    );
  };
  const { isExporting, exportWorkbook } = useCostWorkbookExport({
    enabled: Boolean(version),
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
      }),
  });

  return (
    <div className="space-y-4">
      <ContextBand
        project={project}
        costVersion={activeVersion}
        latestCostVersion={latestVersion}
        versionStatus={version?.state || 'Draft'}
      />
      {version?.calculationNote ? (
        <output className="block border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {version.calculationNote}
        </output>
      ) : null}
      <section className="border border-border bg-card">
        <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-4 md:divide-y-0">
          <div className="px-3 py-2.5">
            <BiText
              en="Version Total"
              zh="本版总成本"
              className="text-[10px] text-muted-foreground"
            />
            <p className="financial-numeral mt-1 text-lg font-semibold">
              {version ? versionTotal(version) : formatSgd(0)}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <BiText
              en="Version Delta"
              zh="版本变化"
              className="text-[10px] text-muted-foreground"
            />
            <p
              className={
                'financial-numeral mt-1 text-xs font-semibold ' +
                'text-[#377054]'
              }
            >
              {version?.sourceVersion
                ? `Cloned from ${version.sourceVersion}`
                : 'Initial version'}
            </p>
            <p className="mt-1 text-[9px] text-muted-foreground">
              {version?.sourceVersion
                ? `复制自 ${version.sourceVersion}`
                : '初始版本'}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <BiText
              en="Input Completeness"
              zh="输入完整度"
              className="text-[10px] text-muted-foreground"
            />
            <div className="mt-1 flex items-center gap-3">
              <span className="financial-numeral text-lg font-semibold">
                {inputCompleteness}%
              </span>
              <Progress
                value={inputCompleteness}
                className="w-24 [&_[data-slot=progress-indicator]]:bg-[#377054]"
              />
            </div>
          </div>
          <div className="px-3 py-2.5">
            <BiText
              en="Calculation Basis"
              zh="计算口径"
              className="text-[10px] text-muted-foreground"
            />
            <p className="mt-1 text-[11px] font-semibold">
              {actualYears[0] ? `FY${String(actualYears[0]).slice(-2)}` : 'FY—'}{' '}
              · SGD · {representativeRate?.hoursPerManday || 0}h/day
            </p>
            <p className="mt-1 text-[9px] text-muted-foreground">
              {representativeRate?.mandaysPerMonth || 0} days / person-month ·{' '}
              {representativeRate?.mandaysPerMonth || 0} 天/人月
            </p>
          </div>
        </div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {[
            { key: 'input' as CostViewKey, en: 'Input Sheet', zh: '成本输入' },
            { key: 'summary' as CostViewKey, en: 'Summary', zh: '多维汇总' },
            {
              key: 'compare' as CostViewKey,
              en: 'Version Comparison',
              zh: '版本对比',
            },
          ].map((item) => (
            <Button
              key={item.key}
              variant={costView === item.key ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setCostView(item.key)}
            >
              {item.en}
              <span className="text-[9px] opacity-60">{item.zh}</span>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[9px] text-muted-foreground sm:inline">
            Selected: Cost {activeVersion} / 当前选择成本 {activeVersion}
          </span>
          <Button
            size="sm"
            onClick={exportWorkbook}
            disabled={isExporting}
            title="Export Cost Detail and summaries in one workbook"
          >
            <Download />
            {isExporting ? 'Exporting…' : 'Export Cost Workbook'}{' '}
            <span className="text-[9px] opacity-60">导出成本工作簿</span>
          </Button>
        </div>
      </div>
      {costView === 'input' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-muted-foreground">
              Version rates · 版本独立汇率
            </span>
            <Button size="sm" variant="outline" onClick={onApplyMasterRates}>
              Apply Master Rates{' '}
              <span className="text-xs opacity-60">应用当前主数据汇率</span>
            </Button>
          </div>
          <RateAssumptions
            settings={rateSettings}
            setSettings={setRateSettings}
          />
          <CostInputSheet
            key={activeVersion}
            rows={rows}
            setRows={setRows}
            rateSettings={rateSettings}
            resourceTypes={resourceTypes}
            includedTravelCost={includedTravelCost}
            announce={announce}
          />
          <HQTravelPanel
            rows={rows}
            resourceTypes={resourceTypes}
            settings={travelSettings}
            setSettings={setTravelSettings}
          />
          {travelRows.length > 0 ? (
            <AdditionalTravelTable
              rows={travelRows}
              setRows={setTravelRows}
              rateSettings={rateSettings}
              travelUplift={travelUplift}
              setTravelUplift={setTravelUplift}
            />
          ) : null}
        </div>
      ) : null}
      {costView === 'summary' ? (
        <CostSummaryView
          rows={rows}
          resourceTypes={resourceTypes}
          travelCost={hqTravelCost}
          manualCosts={manualCosts}
          setManualCosts={setManualCosts}
        />
      ) : null}
      {costView === 'compare' ? (
        <VersionComparisonView
          versions={versions}
          activeVersion={activeVersion}
          resourceTypes={resourceTypes}
          onSelectVersion={onSelectVersion}
          onUpdateVersionState={onUpdateVersionState}
        />
      ) : null}
    </div>
  );
}
