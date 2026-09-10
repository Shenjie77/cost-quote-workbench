import type { SubcontractCost } from '@/features/cost/subcontract-domain';
/** Hierarchical cost statement; only leaf accounts allow manual monetary input. */

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  buildCostStatementRows,
  getCostStatementValues,
  overrideOtherServiceCost,
  roundMoney,
  totalRowCost,
  type CostInputRow,
  type ManualCostInputs,
  type ResourceType,
} from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';

export function CostStatementTable({
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
  const values = getCostStatementValues(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );
  const unmappedRows = rows.filter(
    (row) =>
      totalRowCost(row) > 0 &&
      !resourceTypes.some((resourceType) => resourceType.id === row.reTypeId),
  );
  const unmappedCost = unmappedRows.reduce(
    (sum, row) => sum + totalRowCost(row),
    0,
  );
  const statementRows = buildCostStatementRows(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
  );

  const updateManualCost = (key: keyof ManualCostInputs, value: number) => {
    if (readOnly) return;
    if (key === 'otherService') {
      setManualCosts((current) => overrideOtherServiceCost(current, value));
      return;
    }
    setManualCosts((current) => ({
      ...current,
      [key]: Math.max(0, Number.isFinite(value) ? value : 0),
    }));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-[#f7f5f0] px-4 py-2 text-[10px] text-muted-foreground">
        <span>
          Auto-linked: in-house labour, subcontract/partner cost, and HQ travel.
          <span className="ml-1 text-[9px]">
            自动带入：自有人力、合作成本和 HQ 差旅；2.3.4.2 可按人力成本的 1%
            计算或手动录入。
          </span>
        </span>
        <span className="financial-numeral font-semibold text-[#173a52]">
          Total with risk ·{' '}
          {values.totalWithRisk ? formatSgd(values.totalWithRisk) : '-'}
        </span>
      </div>
      {unmappedRows.length > 0 ? (
        <div
          role="alert"
          className="border-b border-[#dfc99e] bg-[#fff8e8] px-4 py-2 text-[10px] text-[#7a5318]"
        >
          {unmappedRows.length} cost line(s) totaling {formatSgd(unmappedCost)}
          have no valid RE Type and are excluded from this statement. /{' '}
          {unmappedRows.length} 条成本缺少有效资源类型，合计{' '}
          {formatSgd(unmappedCost)}，暂未计入本报表。
        </div>
      ) : null}
      <div className="min-w-0 max-w-full">
        <Table className="min-w-[760px] text-[11px]">
          <caption className="sr-only">
            Cost statement hierarchy based on the supplied report template.
            Auto-linked values come from Cost Input and HQ Travel; remaining
            leaf rows are manually editable.
          </caption>
          <TableHeader>
            <TableRow className="h-9 bg-[#17437a] text-white hover:bg-[#17437a]">
              <TableHead className="w-[55%] border-r border-[#3d6290] px-3 text-white">
                Report Item (SGD){' '}
                <span className="text-[9px] font-normal text-[#cddbeb]">
                  报表项
                </span>
              </TableHead>
              <TableHead className="w-[27%] border-r border-[#3d6290] px-3 text-white">
                Source{' '}
                <span className="text-[9px] font-normal text-[#cddbeb]">
                  来源
                </span>
              </TableHead>
              <TableHead className="w-[18%] px-3 text-right text-white">
                Cost (SGD)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statementRows.map((row) => {
              const isManual = row.mode === 'manual' && row.manualKey;
              const manualAmount =
                row.manualKey === 'otherService'
                  ? row.amount
                  : row.manualKey
                    ? manualCosts[row.manualKey]
                    : 0;
              const rowClass =
                row.mode === 'grand-total'
                  ? 'bg-[#17437a] text-white hover:bg-[#17437a]'
                  : row.mode === 'section'
                    ? 'bg-[#efe0d1] hover:bg-[#efe0d1]'
                    : row.code === '15'
                      ? 'bg-[#f4e5d9] hover:bg-[#f4e5d9]'
                      : row.mode === 'subtotal'
                        ? 'bg-[#e3f0ef] hover:bg-[#e3f0ef]'
                        : 'bg-card hover:bg-[#f2f7f6]';
              return (
                <TableRow
                  key={row.code || row.en}
                  className={'h-9 ' + rowClass}
                >
                  <TableCell className="border-r border-border p-0">
                    <div
                      className="flex min-h-9 items-center gap-2 pr-3"
                      style={{ paddingLeft: 12 + row.level * 22 }}
                    >
                      {row.code ? (
                        <span className="financial-numeral w-[58px] shrink-0 text-[10px] font-semibold">
                          {row.code}
                        </span>
                      ) : null}
                      <span className="min-w-0 font-medium">
                        {row.en}
                        <span
                          className={
                            'ml-1 text-[9px] font-normal ' +
                            (row.mode === 'grand-total'
                              ? 'text-[#d9e6f3]'
                              : 'text-muted-foreground')
                          }
                        >
                          {row.zh}
                        </span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell
                    className={
                      'border-r px-3 text-[9px] ' +
                      (row.mode === 'grand-total'
                        ? 'border-[#3d6290] text-[#d9e6f3]'
                        : 'border-border text-muted-foreground')
                    }
                  >
                    {row.source}
                    {row.manualKey === 'otherService' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-2 h-6 text-[9px]"
                        disabled={
                          readOnly || manualCosts.otherServiceRate === 0.01
                        }
                        onClick={() => {
                          if (!readOnly)
                            setManualCosts((current) => ({
                              ...current,
                              otherServiceRate: 0.01,
                            }));
                        }}
                        title="2.3.4.2 = 2.3.1 人力成本合计 × 1%；输入金额可切换为手动"
                      >
                        {manualCosts.otherServiceRate === 0.01
                          ? '1% · 自动'
                          : 'Use 1% · 按1%计算'}
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell className="p-0 text-right">
                    {isManual && row.manualKey ? (
                      <div className="relative">
                        {!!manualAmount && (
                          <span className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2 text-[9px] text-muted-foreground">
                            S$
                          </span>
                        )}
                        <Input
                          aria-label={`${row.en} cost in SGD`}
                          type="number"
                          disabled={readOnly}
                          min="0"
                          step={
                            row.manualKey === 'otherService' ? '0.01' : '100'
                          }
                          className="financial-numeral h-9 rounded-none border-0 bg-transparent pl-7 pr-2 text-right text-[11px] shadow-none focus-visible:relative focus-visible:z-20 focus-visible:bg-white focus-visible:ring-1"
                          value={manualAmount || ''}
                          placeholder="-"
                          onChange={(event) =>
                            updateManualCost(
                              row.manualKey as keyof ManualCostInputs,
                              Number(event.target.value),
                            )
                          }
                          onBlur={(event) => {
                            if (
                              row.manualKey === 'otherService' &&
                              manualCosts.otherServiceRate !== undefined
                            )
                              return;
                            updateManualCost(
                              row.manualKey as keyof ManualCostInputs,
                              roundMoney(Number(event.target.value)),
                            );
                          }}
                        />
                      </div>
                    ) : (
                      <span className="financial-numeral block px-3 py-2 font-semibold">
                        {row.amount ? formatSgd(row.amount) : '-'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="border-t border-border bg-[#f7f5f0] px-4 py-2 text-[9px] leading-4 text-muted-foreground">
        Non-in-house labour and Subcontract Cost are mutually exclusive: use
        Non-in-house for time-and-material external people, and Subcontract for
        deliverable or fixed-price packages. /
        外包人力与合作成本不可重复计入：外部人力按工时计入外包人力，成果包或固定价合同计入合作成本。
      </div>
    </div>
  );
}
