/** Optional non-HQ travel table; kept outside the governed export snapshot for now. */

import { Plane, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BusinessUnitSelect } from '@/features/master-data/business-unit-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { SectionHeading } from '@/components/workbench/section-heading';
import { StatusBadge } from '@/components/workbench/status-badge';
import {
  getActualYears,
  roundMoney,
  type RateSettings,
} from '@/features/cost/domain';
import {
  getTravelRowTotal,
  getTravelYearCost,
  type TravelCostRow,
  type TravelTreatment,
} from '@/features/cost/additional-travel-domain';
import type { StatusTone } from '@/features/workbench/types';
import { formatSgd } from '@/lib/formatters';

export function AdditionalTravelTable({
  rows,
  setRows,
  rateSettings,
  travelUplift,
  setTravelUplift,
}: {
  rows: TravelCostRow[];
  setRows: React.Dispatch<React.SetStateAction<TravelCostRow[]>>;
  rateSettings: RateSettings;
  travelUplift: number;
  setTravelUplift: (value: number) => void;
}) {
  const actualYears = getActualYears(rateSettings);
  const treatmentLabels: Record<
    TravelTreatment,
    { en: string; zh: string; tone: StatusTone }
  > = {
    included: { en: 'Included', zh: '计入成本', tone: 'green' },
    reimbursable: { en: 'Reimbursable', zh: '实报实销', tone: 'blue' },
    excluded: { en: 'Excluded', zh: '报价排除', tone: 'gray' },
  };
  const treatmentTotals = (['included', 'reimbursable', 'excluded'] as const)
    .map((treatment) => ({
      treatment,
      total: rows
        .filter((row) => row.treatment === treatment)
        .reduce(
          (sum, row) =>
            sum + getTravelRowTotal(row, rateSettings, travelUplift),
          0,
        ),
    }))
    .reduce((result, item) => ({ ...result, [item.treatment]: item.total }), {
      included: 0,
      reimbursable: 0,
      excluded: 0,
    });
  const inputClass =
    'h-8 rounded-sm border-[#d8d5cd] bg-[#fffdf9] px-2 text-xs shadow-none focus-visible:ring-1';

  const updateText = (
    id: string,
    key:
      | 'scope'
      | 'bu'
      | 'destination'
      | 'expenseType'
      | 'unitBasis'
      | 'currency',
    value: string,
  ) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const updateNumber = (
    id: string,
    key: 'baseUnitRate' | 'rateBaseYear',
    value: number,
  ) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  const updateQuantity = (id: string, yearIndex: number, value: number) =>
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              quantities: row.quantities.map((quantity, index) =>
                index === yearIndex ? value : quantity,
              ),
            }
          : row,
      ),
    );
  const updateTreatment = (id: string, treatment: TravelTreatment) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, treatment } : row)),
    );
  const addTravelRow = () =>
    setRows((current) => [
      ...current,
      {
        id: 'TR-' + String(current.length + 1).padStart(3, '0'),
        scope: 'Select Scope',
        bu: '',
        destination: 'Destination',
        expenseType: 'Other',
        unitBasis: 'lump sum',
        baseUnitRate: 0,
        currency: 'SGD',
        rateBaseYear: rateSettings.baseYear,
        quantities: [0, 0, 0, 0, 0],
        treatment: 'included',
      },
    ]);

  return (
    <section className="overflow-hidden border border-border bg-card">
      <SectionHeading
        index="03"
        title="Travel & Expenses"
        titleZh="差旅费用"
        description="Travel is entered separately from mandays and uses its own inflation rule."
        descriptionZh="差旅不参与人天校验，使用独立的价格浮动规则。"
        action={
          <Button size="sm" onClick={addTravelRow}>
            <Plus /> Add Travel Row{' '}
            <span className="text-[9px] opacity-60">新增差旅行</span>
          </Button>
        }
      />
      <div className="grid gap-px border-b border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Included Travel"
            zh="计入固定价成本"
            className="text-[10px] text-muted-foreground"
          />
          <p className="financial-numeral mt-1 text-lg font-semibold">
            {formatSgd(treatmentTotals.included)}
          </p>
        </div>
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Reimbursable"
            zh="实报实销"
            className="text-[10px] text-muted-foreground"
          />
          <p className="financial-numeral mt-1 text-lg font-semibold text-[#376b8a]">
            {formatSgd(treatmentTotals.reimbursable)}
          </p>
        </div>
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Excluded"
            zh="报价排除"
            className="text-[10px] text-muted-foreground"
          />
          <p className="financial-numeral mt-1 text-lg font-semibold text-muted-foreground">
            {formatSgd(treatmentTotals.excluded)}
          </p>
        </div>
        <label className="bg-[#edf4f3] px-3 py-2.5" htmlFor="travel-uplift">
          <BiText
            en="Travel Annual Uplift"
            zh="差旅年度浮动"
            className="text-[10px] text-[#557276]"
          />
          <div className="relative mt-2 max-w-[140px]">
            <Input
              id="travel-uplift"
              type="number"
              step="0.1"
              className="h-8 rounded-sm border-[#aac4c4] bg-white pr-7 text-right text-xs shadow-none focus-visible:ring-1"
              value={travelUplift}
              onChange={(event) => setTravelUplift(Number(event.target.value))}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
          <p className="mt-1 text-[8px] text-[#557276]">
            Separate from labour / 与人力浮动分开
          </p>
        </label>
      </div>
      <div className="workbench-scrollbar overflow-x-auto">
        <Table className="min-w-[1660px]">
          <TableHeader>
            <TableRow className="bg-[#e9e6de] hover:bg-[#e9e6de]">
              <TableHead className="w-[190px] min-w-[190px] px-3">
                <BiText en="Scope" zh="服务范围" />
              </TableHead>
              <TableHead className="w-[180px] min-w-[180px]">
                <BiText en="BU" zh="业务部" />
              </TableHead>
              <TableHead className="w-[130px] min-w-[130px]">
                <BiText en="Destination" zh="目的地 / 站点" />
              </TableHead>
              <TableHead className="w-[135px] min-w-[135px]">
                <BiText en="Expense Type" zh="费用类型" />
              </TableHead>
              <TableHead className="w-[135px] min-w-[135px]">
                <BiText en="Unit Basis" zh="计价单位" />
              </TableHead>
              <TableHead className="w-[120px] min-w-[120px] text-right">
                <BiText
                  en="Base Unit Rate"
                  zh="基础单价"
                  className="items-end"
                />
              </TableHead>
              <TableHead className="w-[90px] min-w-[90px] text-right">
                <BiText en="Base Year" zh="基准年" className="items-end" />
              </TableHead>
              {actualYears.map((year, index) => (
                <TableHead
                  key={year + '-' + index}
                  className="w-[100px] min-w-[100px] border-l border-border text-right"
                >
                  <BiText
                    en={'Y' + (index + 1) + ' · ' + year}
                    zh="数量 / 年度成本"
                    className="items-end"
                  />
                </TableHead>
              ))}
              <TableHead className="w-[160px] min-w-[160px] border-l border-border">
                <BiText en="Treatment" zh="报价处理" />
              </TableHead>
              <TableHead className="w-[130px] min-w-[130px] text-right">
                <BiText en="Total Cost" zh="总成本" className="items-end" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const treatment = treatmentLabels[row.treatment];
              return (
                <TableRow key={row.id} className="bg-card hover:bg-[#f5f4ef]">
                  <TableCell className="px-3">
                    <Input
                      aria-label={'Travel scope for ' + row.id}
                      title={row.scope}
                      className={inputClass}
                      value={row.scope}
                      onChange={(event) =>
                        updateText(row.id, 'scope', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <BusinessUnitSelect
                      aria-label={'Travel BU for ' + row.id}
                      title={row.bu}
                      className={inputClass}
                      value={row.bu}
                      onChange={(event) =>
                        updateText(row.id, 'bu', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Destination for ' + row.id}
                      className={inputClass}
                      value={row.destination}
                      onChange={(event) =>
                        updateText(row.id, 'destination', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Expense type for ' + row.id}
                      className={inputClass}
                      value={row.expenseType}
                      onChange={(event) =>
                        updateText(row.id, 'expenseType', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Unit basis for ' + row.id}
                      className={inputClass}
                      value={row.unitBasis}
                      onChange={(event) =>
                        updateText(row.id, 'unitBasis', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="relative">
                      <Input
                        aria-label={'Base unit rate for ' + row.id}
                        type="number"
                        className={inputClass + ' pl-8 text-right'}
                        value={row.baseUnitRate}
                        onChange={(event) =>
                          updateNumber(
                            row.id,
                            'baseUnitRate',
                            Number(event.target.value),
                          )
                        }
                        onBlur={(event) =>
                          updateNumber(
                            row.id,
                            'baseUnitRate',
                            roundMoney(Number(event.target.value)),
                          )
                        }
                      />
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[8px] text-muted-foreground">
                        {row.currency}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Travel rate base year for ' + row.id}
                      type="number"
                      className={inputClass + ' text-right'}
                      value={row.rateBaseYear}
                      onChange={(event) =>
                        updateNumber(
                          row.id,
                          'rateBaseYear',
                          Number(event.target.value),
                        )
                      }
                    />
                  </TableCell>
                  {row.quantities.map((quantity, yearIndex) => (
                    <TableCell
                      key={row.id + '-travel-' + yearIndex}
                      className="border-l border-border"
                    >
                      <Input
                        aria-label={
                          'Y' + (yearIndex + 1) + ' quantity for ' + row.id
                        }
                        type="number"
                        className={inputClass + ' text-right'}
                        value={quantity}
                        onChange={(event) =>
                          updateQuantity(
                            row.id,
                            yearIndex,
                            Number(event.target.value),
                          )
                        }
                      />
                      <span className="financial-numeral mt-1 block text-right text-[8px] text-muted-foreground">
                        {formatSgd(
                          getTravelYearCost(
                            row,
                            yearIndex,
                            rateSettings,
                            travelUplift,
                          ),
                        )}
                      </span>
                    </TableCell>
                  ))}
                  <TableCell className="border-l border-border">
                    <Select
                      value={row.treatment}
                      onValueChange={(value) =>
                        updateTreatment(row.id, value as TravelTreatment)
                      }
                    >
                      <SelectTrigger
                        className="w-full rounded-sm bg-[#fffdf9] text-xs"
                        aria-label={'Treatment for ' + row.id}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="included">
                          Included / 计入成本
                        </SelectItem>
                        <SelectItem value="reimbursable">
                          Reimbursable / 实报实销
                        </SelectItem>
                        <SelectItem value="excluded">
                          Excluded / 报价排除
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="mt-1">
                      <StatusBadge tone={treatment.tone}>
                        <BiInline en={treatment.en} zh={treatment.zh} />
                      </StatusBadge>
                    </div>
                  </TableCell>
                  <TableCell className="financial-numeral text-right font-semibold">
                    {formatSgd(
                      getTravelRowTotal(row, rateSettings, travelUplift),
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[#f7f5f0] px-4 py-3">
        <div className="flex items-center gap-2 text-[10px] leading-4 text-muted-foreground">
          <Plane className="size-4 text-[#376b8a]" />
          Included travel enters the cost baseline; reimbursable and excluded
          items remain separate.
          <span className="text-[9px]">
            计入型差旅汇入成本基线，实报实销和排除项单独展示。
          </span>
        </div>
        <span className="financial-numeral text-xs font-semibold">
          Included total · {formatSgd(treatmentTotals.included)}
        </span>
      </div>
    </section>
  );
}
