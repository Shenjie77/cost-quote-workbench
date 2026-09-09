import {
  subcontractCostDetails,
  type SubcontractCost,
} from '@/features/cost/subcontract-domain';
/** Reconciled summary across Scope, BU, consolidated RE Type, and accounts. */

import { BarChart3, Clock3, Database, Gauge } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KpiCard } from '@/components/workbench/kpi-card';
import { BreakdownTable } from '@/features/cost/components/breakdown-table';
import { CostStatementTable } from '@/features/cost/components/cost-statement-table';
import {
  buildReconciledCostDimensionSummary,
  buildCostStatementRows,
  buildSubcontractScopeSummary,
  getCostSummaryStatementCode,
  getCostStatementValues,
  totalRowMandays,
  type CostDimensionSummary,
  type CostInputRow,
  type ManualCostInputs,
  type ResourceType,
} from '@/features/cost/domain';
import type { BreakdownItem } from '@/features/cost/ui-types';
import { formatSgd } from '@/lib/formatters';

export function CostSummaryView({
  readOnly = false,
  rows,
  resourceTypes,
  travelCost,
  manualCosts,
  subcontractCost,
  setManualCosts,
}: {
  readOnly?: boolean;
  rows: CostInputRow[];
  resourceTypes: ResourceType[];
  travelCost: number;
  manualCosts: ManualCostInputs;
  subcontractCost?: SubcontractCost;
  setManualCosts: React.Dispatch<React.SetStateAction<ManualCostInputs>>;
}) {
  const statementValues = getCostStatementValues(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );
  const totalMandays = rows.reduce((sum, row) => sum + totalRowMandays(row), 0);
  const scopeCount = new Set(
    [
      ...rows.map((row) => row.scope.trim()),
      ...subcontractCostDetails(subcontractCost).map((line) =>
        line.scope.trim(),
      ),
    ].filter(Boolean),
  ).size;
  const buCount = new Set(
    [
      ...rows.map((row) => row.bu.trim()),
      ...subcontractCostDetails(subcontractCost).map((line) => line.bu.trim()),
    ].filter(Boolean),
  ).size;
  const averageCost =
    totalMandays > 0 ? statementValues.totalWithRisk / totalMandays : 0;
  const palette = ['#173a52', '#2e6f77', '#a86432', '#81918b', '#657e98'];
  const statementRows = buildCostStatementRows(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );
  const toBreakdown = (grouped: CostDimensionSummary[]): BreakdownItem[] =>
    grouped.map((item, index) => ({
      name: item.label,
      nameZh:
        statementRows.find(
          (statement) =>
            statement.code === getCostSummaryStatementCode(item.key),
        )?.zh || '',
      amount: item.cost,
      mandays: item.mandays,
      share: Number((item.shareRatio * 100).toFixed(1)),
      color: palette[index % palette.length],
    }));
  const makeBreakdown = (
    dimension: 'scope' | 'bu' | 'resourceType',
  ): BreakdownItem[] => {
    const grouped = buildReconciledCostDimensionSummary(
      rows,
      dimension,
      resourceTypes,
      travelCost,
      manualCosts,
      subcontractCost,
      { includeRisk: true },
    );
    return toBreakdown(grouped);
  };
  const scopeBreakdown = makeBreakdown('scope');
  const buBreakdown = makeBreakdown('bu');
  const resourceBreakdown = makeBreakdown('resourceType');
  const subcontractBreakdown = toBreakdown(
    buildSubcontractScopeSummary(rows, resourceTypes, subcontractCost),
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard
          label="Total Cost with Risk"
          labelZh="含风险总成本"
          value={formatSgd(statementValues.totalWithRisk)}
          note="Sales Cost + Risk Contingency"
          noteZh="销售成本 + 风险准备金"
          icon={BarChart3}
        />
        <KpiCard
          label="Total Mandays"
          labelZh="总人天"
          value={`${totalMandays.toLocaleString('en-SG')} MD`}
          note="Sites × MD / Site or Direct MD"
          noteZh="站点数 × 单站人天或直接人天"
          icon={Clock3}
          tone="blue"
        />
        <KpiCard
          label="Average Cost / MD"
          labelZh="平均人天成本"
          value={formatSgd(averageCost)}
          note="Total cost with risk divided by mandays"
          noteZh="含风险总成本 ÷ 总人天"
          icon={Gauge}
          tone="green"
        />
        <KpiCard
          label="Input Scopes"
          labelZh="Scope 数量"
          value={String(scopeCount)}
          note={`Across ${buCount} business units`}
          noteZh={`覆盖 ${buCount} 个业务部`}
          icon={Database}
          tone="gray"
        />
      </div>
      <section className="border border-border bg-card">
        <Tabs defaultValue="statement">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div>
              <p className="text-[11px] font-semibold text-[#a86432]">02</p>
              <h2 className="mt-0.5 text-[15px] font-semibold">
                Multidimensional Summary{' '}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  多维成本汇总
                </span>
              </h2>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Dimensions include risk and reference Cost Statement accounts;
                Subcon shows the 2.3.2 breakdown. /
                各维度含风险并引用报表科目；分包页对应 2.3.2。
              </p>
            </div>
            <TabsList variant="line">
              <TabsTrigger value="statement">
                Cost Statement{' '}
                <span className="text-[9px] opacity-60">成本报表</span>
              </TabsTrigger>
              <TabsTrigger value="scope">Scope</TabsTrigger>
              <TabsTrigger value="bu">BU</TabsTrigger>
              <TabsTrigger value="resource-type">
                RE Type & Level{' '}
                <span className="text-[9px] opacity-60">资源类型与级别</span>
              </TabsTrigger>
              <TabsTrigger value="subcontract">Subcon</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="scope">
            <BreakdownTable items={scopeBreakdown} />
          </TabsContent>
          <TabsContent value="bu">
            <BreakdownTable items={buBreakdown} />
          </TabsContent>
          <TabsContent value="resource-type">
            <BreakdownTable items={resourceBreakdown} />
          </TabsContent>
          <TabsContent value="subcontract">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <div>
                <p className="text-sm font-semibold">
                  2.3.2 · Subcontract Cost
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  BOQ scopes and preserved legacy packages /
                  分包条目及历史合作成本
                </p>
              </div>
              <p className="text-lg font-semibold tabular-nums">
                {formatSgd(statementValues.subcontract)}
              </p>
            </div>
            {subcontractBreakdown.length ? (
              <BreakdownTable items={subcontractBreakdown} />
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                No subcontract costs in this version.
              </p>
            )}
          </TabsContent>
          <TabsContent value="statement">
            <CostStatementTable
              readOnly={readOnly}
              rows={rows}
              resourceTypes={resourceTypes}
              travelCost={travelCost}
              manualCosts={manualCosts}
              subcontractCost={subcontractCost}
              setManualCosts={setManualCosts}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
