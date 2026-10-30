import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ManualCostInputs } from '../domain';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import {
  GROUP_COST_NOTE,
  buildGroupCostSheetLayout,
  overrideCategoryRiskAmount,
  type GroupCostSummaryRow,
} from '../group-cost-summary';
import { formatSgd } from '@/lib/formatters';
import { roundMoney, roundQuantity } from '../domain';

const measures = [
  ['mandays', 'Mandays'],
  ['personnel', 'Personnel'],
  ['travel', 'HQ Travel'],
  ['subcontract', 'Subcontract'],
  ['ehs', 'EHS'],
  ['risk', 'Risk'],
  ['other', 'Other'],
  ['total', 'Total Cost'],
  ['share', 'Share'],
] as const;
const display = (key: (typeof measures)[number][0], value: number) =>
  key === 'mandays'
    ? roundQuantity(value).toLocaleString('en-SG')
    : key === 'share'
      ? `${(value * 100).toFixed(1)}%`
      : formatSgd(roundMoney(value));

export function GroupCostTable({
  items,
  readOnly = false,
  manualCosts,
  setManualCosts,
}: {
  items: GroupCostSummaryRow[];
  readOnly?: boolean;
  manualCosts?: ManualCostInputs;
  setManualCosts?: React.Dispatch<React.SetStateAction<ManualCostInputs>>;
}) {
  const { sections, totals } = buildGroupCostSheetLayout(items);
  return (
    <>
      {setManualCosts && (
        <div className="flex flex-wrap items-end gap-4 border-b p-4">
          <div className="w-full text-sm">
            Risk allocation / 风险占比（默认按各 Category 风险前金额分摊）
            <p className="mt-1 text-xs text-muted-foreground">
              修改分类风险金额会同步更新总额；按比例重置保留总额。
            </p>
          </div>
          <label className="text-xs">
            Risk total (SGD) / 风险准备金总额
            <Input
              money
              type="number"
              min="0"
              step="0.01"
              aria-label="Risk Contingency total in SGD"
              disabled={readOnly}
              value={manualCosts?.riskContingency ?? totals.risk}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!readOnly && Number.isFinite(value) && value >= 0)
                  setManualCosts((current) => ({
                    ...current,
                    riskContingency: roundMoney(value),
                  }));
              }}
              className="mt-1 w-44"
            />
          </label>
          {sections.map((section) => {
            const share =
              section.items.find((item) => item.accountCode === '15')
                ?.riskWeight ?? 0;
            return (
              <label key={section.key} className="text-xs">
                {section.label} %
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  disabled={readOnly}
                  aria-label={`${section.label} risk percentage`}
                  value={Number((share * 100).toFixed(4))}
                  onChange={(event) => {
                    if (
                      readOnly ||
                      !Number.isFinite(Number(event.target.value))
                    )
                      return;
                    const next = Math.min(
                      1,
                      Math.max(0, Number(event.target.value) / 100),
                    );
                    const others = 1 - share;
                    setManualCosts((current) => ({
                      ...current,
                      categoryRiskWeights: sections.map((item) => ({
                        category: item.category ?? '',
                        weight:
                          sections.length === 1
                            ? 1
                            : item.key === section.key
                              ? next
                              : others > 0
                                ? ((item.items.find(
                                    (row) => row.accountCode === '15',
                                  )?.riskWeight ?? 0) *
                                    (1 - next)) /
                                  others
                                : (1 - next) / (sections.length - 1),
                      })),
                    }));
                  }}
                  className="mt-1 w-32"
                />
              </label>
            );
          })}
          <Button
            variant="outline"
            disabled={readOnly || !manualCosts?.categoryRiskWeights?.length}
            onClick={() => {
              if (!readOnly)
                setManualCosts((current) => ({
                  ...current,
                  categoryRiskWeights: [],
                }));
            }}
          >
            Reset by proportion / 按比例重置
          </Button>
        </div>
      )}
      <Table aria-label="Group cost summary" className="min-w-[1400px]">
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead className="w-56">Group / Account</TableHead>
            <TableHead>Level</TableHead>
            {measures.map(([key, label]) => (
              <TableHead key={key} className="text-right">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => (
            <Fragment key={section.key}>
              <TableRow className="bg-muted/70">
                <TableCell colSpan={12} className="font-semibold">
                  {section.kind === 'Category'
                    ? `Category: ${section.label}`
                    : section.label}
                </TableCell>
              </TableRow>
              {section.items.map((item) => (
                <TableRow key={item.key}>
                  <TableCell>
                    {section.kind === 'Category' ? section.label : '—'}
                  </TableCell>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell>
                    {item.kind === 'Group' ? 'Group' : 'Project'}
                  </TableCell>
                  {measures.map(([key]) => (
                    <TableCell
                      key={key}
                      className={`text-right tabular-nums ${key === 'total' ? 'font-semibold' : ''}`}
                    >
                      {key === 'risk' &&
                      item.accountCode === '15' &&
                      setManualCosts ? (
                        <Input
                          money
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`${section.label} risk amount in SGD`}
                          disabled={readOnly}
                          value={item.risk}
                          className="min-w-28 text-right"
                          onChange={(event) => {
                            if (readOnly) return;
                            setManualCosts((current) =>
                              overrideCategoryRiskAmount(
                                current,
                                sections.map((entry) => ({
                                  category: entry.category ?? '',
                                  amount: entry.totals.risk,
                                })),
                                section.category ?? '',
                                Number(event.target.value),
                              ),
                            );
                          }}
                        />
                      ) : (
                        display(key, item[key])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-semibold">
                <TableCell colSpan={3}>
                  {section.kind === 'Category'
                    ? `${section.label} — Category Subtotal`
                    : 'Project Accounts Subtotal'}
                </TableCell>
                {measures.map(([key]) => (
                  <TableCell key={key} className="text-right tabular-nums">
                    {display(key, section.totals[key])}
                  </TableCell>
                ))}
              </TableRow>
            </Fragment>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total Cost with Risk</TableCell>
            {measures.map(([key]) => (
              <TableCell key={key} className="text-right tabular-nums">
                {display(key, totals[key])}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
      <p className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">
        {GROUP_COST_NOTE}
      </p>
    </>
  );
}
import { Fragment } from 'react';
