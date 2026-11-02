import { Surface, Text } from '@/components/ui/presentation';
import { PercentageInput } from '@/components/ui/percentage-input';
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
  const inputClass = 'w-full';

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
    <Surface as="section" variant="panel" className="min-w-0 overflow-hidden">
      <SectionHeading
        index="03"
        title="Travel & Expenses"
        titleZh="差旅费用"
        description="Travel is entered separately from mandays and uses its own inflation rule."
        descriptionZh="差旅不参与人天校验，使用独立的价格浮动规则。"
        action={
          <Button size="sm" onClick={addTravelRow}>
            <Plus /> Add Travel Row{' '}
            <Text as="span" textRole="body-small">
              新增差旅行
            </Text>
          </Button>
        }
      />
      <Surface
        as="div"
        variant="item"
        className="grid gap-px sm:grid-cols-2 xl:grid-cols-4"
      >
        <Surface as="div" variant="inset">
          <BiText en="Included Travel" zh="计入固定价成本" />
          <Text as="p" textRole="h3" className="financial-numeral mt-1">
            {formatSgd(treatmentTotals.included)}
          </Text>
        </Surface>
        <Surface as="div" variant="inset">
          <BiText en="Reimbursable" zh="实报实销" />
          <Text
            as="p"
            tone="primary"
            textRole="h3"
            className="financial-numeral mt-1"
          >
            {formatSgd(treatmentTotals.reimbursable)}
          </Text>
        </Surface>
        <Surface as="div" variant="inset">
          <BiText en="Excluded" zh="报价排除" />
          <Text
            as="p"
            tone="muted"
            textRole="h3"
            className="financial-numeral mt-1"
          >
            {formatSgd(treatmentTotals.excluded)}
          </Text>
        </Surface>
        <Surface as="label" variant="field" htmlFor="travel-uplift">
          <BiText en="Travel Annual Uplift" zh="差旅年度浮动" />
          <div className="relative mt-2 max-w-[140px]">
            <PercentageInput
              id="travel-uplift"
              step="0.1"
              className="text-right"
              value={travelUplift}
              onChange={(event) => setTravelUplift(Number(event.target.value))}
            />
            <Text
              as="span"
              tone="muted"
              textRole="body-small"
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
            >
              %
            </Text>
          </div>
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            Separate from labour / 与人力浮动分开
          </Text>
        </Surface>
      </Surface>
      <div className="workbench-scrollbar overflow-x-auto">
        <Table className="min-w-[1660px]">
          <TableHeader>
            <TableRow tone="subtotal">
              <TableHead className="w-[190px] min-w-[190px]">
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
              <TableHead
                variant="numeric"
                className="w-[120px] min-w-[120px] text-right"
              >
                <BiText
                  en="Base Unit Rate"
                  zh="基础单价"
                  className="items-end"
                />
              </TableHead>
              <TableHead
                variant="numeric"
                className="w-[90px] min-w-[90px] text-right"
              >
                <BiText en="Base Year" zh="基准年" className="items-end" />
              </TableHead>
              {actualYears.map((year, index) => (
                <TableHead
                  variant="numeric"
                  key={year + '-' + index}
                  className="w-[100px] min-w-[100px] text-right"
                >
                  <BiText
                    en={'Y' + (index + 1) + ' · ' + year}
                    zh="数量 / 年度成本"
                    className="items-end"
                  />
                </TableHead>
              ))}
              <TableHead className="w-[160px] min-w-[160px]">
                <BiText en="Treatment" zh="报价处理" />
              </TableHead>
              <TableHead
                variant="numeric"
                className="w-[130px] min-w-[130px] text-right"
              >
                <BiText en="Total Cost" zh="总成本" className="items-end" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const treatment = treatmentLabels[row.treatment];
              return (
                <TableRow tone="subtotal" key={row.id}>
                  <TableCell>
                    <Input
                      aria-label={'Travel scope for ' + row.id}
                      title={row.scope}

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

                      value={row.destination}
                      onChange={(event) =>
                        updateText(row.id, 'destination', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Expense type for ' + row.id}

                      value={row.expenseType}
                      onChange={(event) =>
                        updateText(row.id, 'expenseType', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Unit basis for ' + row.id}

                      value={row.unitBasis}
                      onChange={(event) =>
                        updateText(row.id, 'unitBasis', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="relative">
                      <Input
                        money
                        aria-label={'Base unit rate for ' + row.id}
                        type="number"
                        className={inputClass + ' text-right '}
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
                      <Text
                        as="span"
                        tone="muted"
                        textRole="body-small"
                        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
                      >
                        {row.currency}
                      </Text>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={'Travel rate base year for ' + row.id}
                      type="number"
                      className={inputClass + ' text-right '}
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
                    <TableCell key={row.id + '-travel-' + yearIndex}>
                      <Input
                        aria-label={
                          'Y' + (yearIndex + 1) + ' quantity for ' + row.id
                        }
                        type="number"
                        className={inputClass + ' text-right '}
                        value={quantity}
                        onChange={(event) =>
                          updateQuantity(
                            row.id,
                            yearIndex,
                            Number(event.target.value),
                          )
                        }
                      />
                      <Text
                        as="span"
                        tone="muted"
                        textRole="body-small"
                        className="financial-numeral mt-1 block text-right"
                      >
                        {formatSgd(
                          getTravelYearCost(
                            row,
                            yearIndex,
                            rateSettings,
                            travelUplift,
                          ),
                        )}
                      </Text>
                    </TableCell>
                  ))}
                  <TableCell>
                    <Select
                      value={row.treatment}
                      onValueChange={(value) =>
                        updateTreatment(row.id, value as TravelTreatment)
                      }
                    >
                      <SelectTrigger
                        className="w-full"
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
                  <TableCell
                    variant="numeric"
                    className="financial-numeral text-right"
                  >
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
      <Surface
        as="div"
        variant="footer"
        className="flex flex-wrap items-center justify-between"
      >
        <Surface
          as="div"
          tone="muted"
          textRole="body-small"
          className="flex items-center gap-2"
        >
          <Text as={Plane} tone="primary" className="size-4" />
          Included travel enters the cost baseline; reimbursable and excluded
          items remain separate.
          <Text as="span" textRole="body-small">
            计入型差旅汇入成本基线，实报实销和排除项单独展示。
          </Text>
        </Surface>
        <Text as="span" textRole="body-small" className="financial-numeral">
          Included total · {formatSgd(treatmentTotals.included)}
        </Text>
      </Surface>
    </Surface>
  );
}
