import { Surface, Text } from '@/components/ui/presentation';
import {
  buildGroupCostSummary,
  buildGroupCostSections,
  categoryStatementAmounts,
  overrideCategoryRiskAmount,
} from '../group-cost-summary';
import type { TravelSettings } from '../domain';
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
  isCostStatementGroupRow,
  overrideOtherServiceCost,
  roundMoney,
  totalRowCost,
  type CostInputRow,
  type ManualCostInputs,
  type ResourceType,
} from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';

/** Render statement hierarchy and keep manual account edits available in grouped rows. */
export function CostStatementTable({
  readOnly = false,
  rows,
  resourceTypes,
  travelCost,
  travelSettings,
  manualCosts,
  subcontractCost,
  subcontractStartYear,
  setManualCosts,
}: {
  readOnly?: boolean;
  rows: CostInputRow[];
  resourceTypes: ResourceType[];
  travelCost: number;
  travelSettings?: TravelSettings;
  manualCosts: ManualCostInputs;
  subcontractCost?: SubcontractCost;
  subcontractStartYear?: number | null;
  setManualCosts: React.Dispatch<React.SetStateAction<ManualCostInputs>>;
}) {
  const values = getCostStatementValues(
    rows,
    resourceTypes,
    travelCost,
    manualCosts,
    subcontractCost,
    subcontractStartYear,
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
    subcontractStartYear,
  );

  const categories = travelSettings
    ? buildGroupCostSections(
        buildGroupCostSummary(
          rows,
          resourceTypes,
          travelSettings,
          manualCosts,
          subcontractCost,
          subcontractStartYear,
        ),
      ).map((section) => ({
        ...section,
        amounts: categoryStatementAmounts(section.items),
      }))
    : [];

  /** Commit editable amounts; changing EHS explicitly switches from percentage to manual. */
  const updateManualCost = (
    key: Exclude<keyof ManualCostInputs, 'categoryRiskWeights'>,
    value: number,
  ) => {
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
      <Surface
        as="div"
        variant="item"
        tone="muted"
        textRole="body-small"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <span>
          EHS 1% = (2.3.1 + 2.3.2 + 2.3.3) × 1%.
          <Text as="span" textRole="body-small" className="ml-1">
            人力、合作及结算成本合计的 1%，也可手动录入金额。
          </Text>
        </span>
        <Text as="span" tone="primary" className="financial-numeral">
          Total with risk ·{' '}
          {values.totalWithRisk ? formatSgd(values.totalWithRisk) : '-'}
        </Text>
      </Surface>
      {unmappedRows.length > 0 ? (
        <Surface
          role="alert"
          as="div"
          variant="item"
          tone="warning"
          textRole="body-small"
        >
          {unmappedRows.length} cost line(s) totaling {formatSgd(unmappedCost)}
          have no valid RE Type and are excluded from this statement. /{' '}
          {unmappedRows.length} 条成本缺少有效资源类型，合计{' '}
          {formatSgd(unmappedCost)}，暂未计入本报表。
        </Surface>
      ) : null}
      <div className="min-w-0 max-w-full">
        <Table className="min-w-[760px]">
          <caption className="sr-only">
            Cost statement hierarchy based on the supplied report template.
            Auto-linked values come from Cost Input and HQ Travel; remaining
            leaf rows are manually editable.
          </caption>
          <TableHeader>
            <TableRow tone="total" className="h-9">
              <TableHead className="w-[55%]">
                Report Item (SGD){' '}
                <Text as="span" tone="inverse" textRole="body-small">
                  报表项
                </Text>
              </TableHead>
              <TableHead className="w-[27%]">
                Source{' '}
                <Text as="span" tone="inverse" textRole="body-small">
                  来源
                </Text>
              </TableHead>
              <TableHead variant="numeric" className="w-[18%] text-right">
                Cost (SGD)
              </TableHead>
              {categories.map((category) => (
                <TableHead
                  variant="numeric"
                  key={category.key}
                  className="min-w-36 text-right"
                >
                  {category.label} Cost (SGD)
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {statementRows.map((row) => {
              // Visual grouping is independent of input mode: settlement remains editable.
              const isGroupRow = isCostStatementGroupRow(row);
              const isManual = row.mode === 'manual' && row.manualKey;
              const manualAmount =
                row.manualKey === 'otherService'
                  ? row.amount
                  : row.manualKey
                    ? manualCosts[row.manualKey]
                    : 0;
              return (
                <TableRow
                  key={row.code || row.en}
                  tone={
                    row.mode === 'grand-total'
                      ? 'total'
                      : row.mode === 'section'
                        ? 'section'
                        : row.code === '15'
                          ? 'risk'
                          : isGroupRow
                            ? 'subtotal'
                            : 'normal'
                  }
                >
                  <TableCell variant="editable">
                    <div className="ui-statement-label" data-level={row.level}>
                      {row.code ? (
                        <Text
                          as="span"
                          textRole="body-small"
                          className="financial-numeral w-[58px] shrink-0"
                        >
                          {row.code}
                        </Text>
                      ) : null}
                      <span className="min-w-0">
                        {row.en}
                        <Text
                          as="span"
                          tone={
                            row.mode === 'grand-total' ? 'inverse' : 'muted'
                          }
                          textRole="body-small"
                          className={' ml-1 ' + ''}
                        >
                          {row.zh}
                        </Text>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.source}
                    {row.manualKey === 'riskContingency' ? (
                      <Button
                        size="sm"
                        variant="outline"

                        disabled={
                          readOnly || !manualCosts.categoryRiskWeights?.length
                        }
                        title="保留风险准备金总额，按各 Category 风险前成本金额重新分摊"
                        onClick={() => {
                          if (!readOnly)
                            setManualCosts((current) => ({
                              ...current,
                              categoryRiskWeights: [],
                            }));
                        }}
                      >
                        Reset by proportion · 按比例重置
                      </Button>
                    ) : null}
                    {row.manualKey === 'otherService' ? (
                      <Button
                        size="sm"
                        variant="outline"

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
                        title="2.3.4.2 = (2.3.1 + 2.3.2 + 2.3.3) × 1%；输入金额可切换为手动"
                      >
                        {manualCosts.otherServiceRate === 0.01
                          ? '1% · 自动'
                          : 'Use 1% · 按1%计算'}
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell variant="editable" className="text-right">
                    {isManual && row.manualKey ? (
                      <div className="relative">
                        {!!manualAmount && (
                          <Text
                            as="span"
                            tone="muted"
                            textRole="body-small"
                            className="pointer-events-none absolute left-2 top-1/2 z-10 -translate-y-1/2"
                          >
                            S$
                          </Text>
                        )}
                        <Input
                          variant="grid"
                          money
                          aria-label={`${row.en} cost in SGD`}
                          type="number"
                          disabled={readOnly}
                          min="0"
                          step={
                            row.manualKey === 'otherService' ||
                            row.manualKey === 'riskContingency'
                              ? '0.01'
                              : '100'
                          }
                          className="financial-numeral text-right focus-visible:relative focus-visible:z-20"
                          value={manualAmount || ''}
                          placeholder="-"
                          onChange={(event) =>
                            updateManualCost(
                              row.manualKey as Exclude<
                                keyof ManualCostInputs,
                                'categoryRiskWeights'
                              >,
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
                              row.manualKey as Exclude<
                                keyof ManualCostInputs,
                                'categoryRiskWeights'
                              >,
                              roundMoney(Number(event.target.value)),
                            );
                          }}
                        />
                      </div>
                    ) : (
                      <Text as="span" className="financial-numeral block">
                        {row.amount ? formatSgd(row.amount) : '-'}
                      </Text>
                    )}
                  </TableCell>
                  {categories.map((category) => (
                    <TableCell
                      variant="numeric"
                      key={category.key}
                      className="text-right tabular-nums"
                    >
                      {row.code === '15' ? (
                        <Input
                          money
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={readOnly}
                          aria-label={`${category.label} risk amount in SGD`}
                          value={category.amounts['15'] ?? 0}
                          className="min-w-28 text-right"
                          onChange={(event) => {
                            if (!readOnly)
                              setManualCosts((current) =>
                                overrideCategoryRiskAmount(
                                  current,
                                  categories.map((entry) => ({
                                    category: entry.category ?? '',
                                    amount: entry.amounts['15'] ?? 0,
                                  })),
                                  category.category ?? '',
                                  Number(event.target.value),
                                ),
                              );
                          }}
                        />
                      ) : (
                        formatSgd(category.amounts[row.code] ?? 0)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Surface as="div" variant="footer" tone="muted" textRole="body-small">
        Non-in-house labour and Subcontract Cost are mutually exclusive: use
        Non-in-house for time-and-material external people, and Subcontract for
        deliverable or fixed-price packages. /
        外包人力与合作成本不可重复计入：外部人力按工时计入外包人力，成果包或固定价合同计入合作成本。
      </Surface>
    </div>
  );
}
