/** Dense editable cost grid. Sites are inputs; mandays are always Sites × MD/Site. */

import { useState } from 'react';
import { CostImportPanel } from './cost-import-panel';
import {
  AlertTriangle,
  Check,
  Filter,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
import { formatSgd } from '@/lib/formatters';
import {
  YEAR_BUCKETS,
  calculatedYearCost,
  getActualYears,
  getLabourRateFactors,
  getY1Year,
  roundMoney,
  totalRowCost,
  totalRowMandays,
  totalRowSites,
  yearRowMandays,
  type CostInputRow,
  type RateSettings,
  type ResourceType,
  type YearAllocation,
} from '@/features/cost/domain';

export function CostInputSheet({
  rows,
  setRows,
  rateSettings,
  setRateSettings,
  resourceTypes,
  includedTravelCost,
  announce,
}: {
  rows: CostInputRow[];
  setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>>;
  rateSettings: RateSettings;
  setRateSettings: React.Dispatch<React.SetStateAction<RateSettings>>;
  resourceTypes: ResourceType[];
  includedTravelCost: number;
  announce: (message: string) => void;
}) {
  const [showImport, setShowImport] = useState(false);
  const updateText = (
    id: string,
    key: 'scope' | 'bu' | 'reTypeId',
    value: string,
  ) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );

  /** Changes the consolidated RE Type and refreshes governed labour cost. */
  const updateResourceType = (id: string, reTypeId: string) =>
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const changed = { ...row, reTypeId };
        return {
          ...changed,
          years: changed.years.map((year, yearIndex) => ({
            ...year,
            cost: calculatedYearCost(
              changed,
              yearIndex,
              resourceTypes,
              rateSettings,
            ),
          })),
        };
      }),
    );
  const updateBase = (id: string, value: number) =>
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const changed = { ...row, mdPerSite: value };
        return {
          ...changed,
          years: changed.years.map((year, yearIndex) => ({
            ...year,
            cost: calculatedYearCost(
              changed,
              yearIndex,
              resourceTypes,
              rateSettings,
            ),
          })),
        };
      }),
    );
  const updateYear = (
    id: string,
    yearIndex: number,
    key: keyof YearAllocation,
    value: number,
  ) =>
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const changed = {
          ...row,
          years: row.years.map((year, index) =>
            index === yearIndex ? { ...year, [key]: value } : year,
          ),
        };
        const resourceType = resourceTypes.find(
          (item) => item.id === row.reTypeId,
        );
        if (
          (key !== 'sites' && key !== 'mandays') ||
          resourceType?.category !== 'internal'
        ) {
          return changed;
        }
        return {
          ...changed,
          years: changed.years.map((year, index) =>
            index === yearIndex
              ? {
                  ...year,
                  cost: calculatedYearCost(
                    changed,
                    yearIndex,
                    resourceTypes,
                    rateSettings,
                  ),
                }
              : year,
          ),
        };
      }),
    );

  const recalculateInternalRows = () =>
    setRows((current) =>
      current.map((row) => ({
        ...row,
        years: row.years.map((year, yearIndex) => ({
          ...year,
          cost: calculatedYearCost(row, yearIndex, resourceTypes, rateSettings),
        })),
      })),
    );
  const totals = {
    sites: rows.reduce((sum, row) => sum + totalRowSites(row), 0),
    mandays: rows.reduce((sum, row) => sum + totalRowMandays(row), 0),
    cost: rows.reduce((sum, row) => sum + totalRowCost(row), 0),
    years: Array.from({ length: YEAR_BUCKETS.length }, (_, index) => ({
      sites: rows.reduce(
        (sum, row) => sum + Number(row.years[index]?.sites || 0),
        0,
      ),
      mandays: rows.reduce((sum, row) => sum + yearRowMandays(row, index), 0),
      cost: roundMoney(
        rows.reduce(
          (sum, row) => sum + roundMoney(Number(row.years[index]?.cost || 0)),
          0,
        ),
      ),
    })),
  };
  const actualYears = getActualYears(rateSettings);
  const labourRateFactors = getLabourRateFactors(rateSettings);
  const yearColumns = actualYears.map((actualYear, index) => ({
    label: YEAR_BUCKETS[index],
    actualYear,
    factor: labourRateFactors[index],
    hint: 'Year ' + (index + 1) + ' / 第 ' + (index + 1) + ' 年',
  }));
  const rowHasInvalidValues = (row: CostInputRow) =>
    !Number.isFinite(Number(row.mdPerSite)) ||
    Number(row.mdPerSite) < 0 ||
    row.years.some(
      (year) =>
        !Number.isFinite(Number(year.sites)) ||
        !Number.isInteger(Number(year.sites)) ||
        Number(year.sites) < 0 ||
        !Number.isFinite(Number(year.cost)) ||
        Number(year.cost) < 0 ||
        (row.inputMode === 'mandays' &&
          (!Number.isFinite(year.mandays) ||
            Number(year.mandays) < 0 ||
            Number(year.mandays) > 1e6)),
    );
  const rowMissingMdPerSite = (row: CostInputRow) =>
    totalRowSites(row) > 0 && Number(row.mdPerSite) <= 0;
  const rowUsesUnmappedYears = (row: CostInputRow) =>
    getY1Year(rateSettings) === null &&
    row.years.some(
      (year) =>
        Number(year.sites || 0) > 0 ||
        Number(year.mandays || 0) > 0 ||
        Number(year.cost || 0) > 0,
    );
  const allRowsValid = rows.every((row) => {
    const resourceType = resourceTypes.find((item) => item.id === row.reTypeId);
    return (
      !rowHasInvalidValues(row) &&
      !rowMissingMdPerSite(row) &&
      !rowUsesUnmappedYears(row) &&
      Boolean(row.scope.trim()) &&
      Boolean(row.bu.trim()) &&
      Boolean(resourceType)
    );
  });
  const inputClass =
    'h-9 w-full rounded-none border-0 bg-transparent px-2 py-0 text-[11px] shadow-none focus-visible:relative focus-visible:z-20 focus-visible:bg-white focus-visible:ring-1';

  const addRow = (inputMode: 'sites' | 'mandays' = 'sites') =>
    setRows((current) => [
      ...current,
      {
        // A timestamp-based ID remains unique even after earlier rows are
        // deleted, avoiding duplicate React keys and SQLite identifiers.
        id: `CI-${Date.now().toString(36).toUpperCase()}`,
        scope: 'New Scope',
        bu: 'Select BU',
        reTypeId: resourceTypes.find((item) => item.active)?.id ?? '',
        mdPerSite: 0,
        inputMode,
        years: Array.from({ length: YEAR_BUCKETS.length }, (_, index) => ({
          bucket: YEAR_BUCKETS[index],
          sites: 0,
          cost: 0,
          ...(inputMode === 'mandays' ? { mandays: 0 } : {}),
        })),
      },
    ]);

  /** Removes only the selected cost line after an explicit confirmation. */
  const deleteRow = (row: CostInputRow) => {
    if (
      !window.confirm(
        `Delete ${row.scope || row.id}? This removes the row from the active version only.\n删除该成本行？仅从当前版本删除。`,
      )
    ) {
      return;
    }
    setRows((current) => current.filter((item) => item.id !== row.id));
    announce(`${row.scope || row.id} deleted / 成本行已删除`);
  };

  return (
    <section className="overflow-hidden border border-border bg-card">
      {showImport && (
        <CostImportPanel
          rows={rows}
          setRows={setRows}
          resources={resourceTypes}
          rates={rateSettings}
          onClose={() => setShowImport(false)}
        />
      )}
      <SectionHeading
        index="02"
        title="Cost Input Sheet"
        titleZh="成本输入"
        description="Enter annual site counts for Y1–Y5; Y1 follows the TD delivery start year."
        descriptionZh="按 Y1–Y5 录入年度站点数；Y1 由 TD 交付开始年份决定。"
        action={
          <StatusBadge tone="blue">
            <BiInline en="Grid view" zh="高密度表格" />
          </StatusBadge>
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            aria-label="Include Local and ARP 3% allowance in annual cost"
            checked={rateSettings.localArpAllowanceEnabled === true}
            onCheckedChange={(checked) =>
              setRateSettings((current) => ({
                ...current,
                localArpAllowanceEnabled: checked,
              }))
            }
          />
          Local + ARP allowance 3%
        </label>
        <span className="text-sm text-muted-foreground">
          开启后 Y1–Y5 Cost 直接包含 3%；HQ 和分包不变。
        </span>
      </div>
      <div className="grid gap-px border-b border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Draft Total Cost"
            zh="草稿总成本"
            className="text-[10px] text-muted-foreground"
          />
          <p className="financial-numeral mt-1 text-lg font-semibold">
            {formatSgd(totals.cost + includedTravelCost)}
          </p>
          <p className="mt-1 text-[9px] text-muted-foreground">
            Cost lines + included travel / 成本行 + 包含型差旅
          </p>
        </div>
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Total Mandays"
            zh="总人天"
            className="text-[10px] text-muted-foreground"
          />
          <p className="financial-numeral mt-1 text-lg font-semibold">
            {totals.mandays.toLocaleString('en-SG')} MD
          </p>
          <p className="mt-1 text-[9px] text-muted-foreground">
            {totals.sites.toLocaleString('en-SG')} allocated sites /
            年度站点合计
          </p>
        </div>
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Included Travel"
            zh="计入成本的差旅"
            className="text-[10px] text-muted-foreground"
          />
          <p className="financial-numeral mt-1 text-lg font-semibold">
            {formatSgd(includedTravelCost)}
          </p>
          <p className="mt-1 text-[9px] text-muted-foreground">
            Detailed below / 明细见下方
          </p>
        </div>
        <div className="bg-[#f7f5f0] px-3 py-2.5">
          <BiText
            en="Validation"
            zh="一致性校验"
            className="text-[10px] text-muted-foreground"
          />
          <div className="mt-1">
            <StatusBadge tone={allRowsValid ? 'green' : 'amber'}>
              <BiInline
                en={allRowsValid ? 'All valid' : 'Review required'}
                zh={allRowsValid ? '全部通过' : '需要核对'}
              />
            </StatusBadge>
          </div>
        </div>
      </div>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border bg-[#f8f7f3] px-2 py-1.5">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="financial-numeral border-r border-border px-2 font-semibold text-foreground">
            {rows.length} rows
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() =>
              announce(
                'Filter controls will be connected with the local database. / 筛选器将在接入本地数据库后启用。',
              )
            }
          >
            <Filter className="size-3" /> Filter{' '}
            <span className="text-[8px] opacity-60">筛选</span>
          </Button>
          <span className="hidden text-[9px] sm:inline">
            Edit directly in cells · 横向滚动查看更多列
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => setShowImport(!showImport)}
          >
            <Upload className="size-3" /> Import{' '}
            <span className="text-[8px] opacity-60">导入</span>
          </Button>
          <Button
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => addRow()}
          >
            <Plus className="size-3" /> Add row{' '}
            <span className="text-[8px] opacity-60">新增</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => addRow('mandays')}>
            Add direct MD / 总人天行
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={recalculateInternalRows}
          >
            Apply RE rates <span className="text-[8px] opacity-60">重算</span>
          </Button>
        </div>
      </div>
      <div className="min-w-0 max-w-full">
        <Table className="w-max min-w-full text-[11px]">
          <caption className="sr-only">
            Editable cost input grid. Enter Sites for Y1 to Y5; Mandays are
            calculated as Sites multiplied by MD per Site.
          </caption>
          <TableHeader>
            <TableRow className="h-8 bg-[#e9e6de] hover:bg-[#e9e6de]">
              <TableHead
                rowSpan={2}
                className="sticky left-0 z-10 w-[220px] min-w-[220px] border-r border-border bg-[#e9e6de] px-2"
              >
                <BiText en="Scope" zh="服务范围" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="sticky left-[220px] z-10 w-[150px] min-w-[150px] border-r border-border bg-[#e9e6de] px-2"
              >
                <BiText en="BU" zh="业务部" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="sticky left-[370px] z-10 w-[165px] min-w-[165px] border-r border-border bg-[#e9e6de] px-2"
              >
                <BiText en="RE Type" zh="资源类型" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="w-[78px] min-w-[78px] border-r border-border px-2 text-right"
              >
                <BiText en="MD / Site" zh="单站人天" className="items-end" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="w-[62px] min-w-[62px] border-r border-border px-2 text-right"
              >
                <BiText en="Total Sites" zh="总站点数" className="items-end" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="w-[82px] min-w-[82px] border-r border-border px-2 text-right"
              >
                <BiText en="Total MD" zh="总人天" className="items-end" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="w-[116px] min-w-[116px] border-r border-border px-2 text-right"
              >
                <BiText en="Total Cost" zh="总成本" className="items-end" />
              </TableHead>
              {yearColumns.map((year) => (
                <TableHead
                  key={year.label}
                  colSpan={3}
                  className="h-8 border-r border-border px-2 text-center"
                >
                  <span className="financial-numeral font-semibold">
                    {year.label}
                  </span>
                  <span className="ml-1 text-[9px] font-normal text-muted-foreground">
                    {year.actualYear ?? 'Set dates'} · {year.factor.toFixed(4)}×
                  </span>
                </TableHead>
              ))}
              <TableHead
                rowSpan={2}
                className="w-[96px] min-w-[96px] px-2 text-center"
              >
                <BiText en="Check" zh="校验" className="items-center" />
              </TableHead>
              <TableHead
                rowSpan={2}
                className="w-[68px] min-w-[68px] px-2 text-center"
              >
                <BiText en="Action" zh="操作" className="items-center" />
              </TableHead>
            </TableRow>
            <TableRow className="h-7 bg-[#f2f0ea] hover:bg-[#f2f0ea]">
              {yearColumns.flatMap((year) => [
                <TableHead
                  key={'sites-' + year.label}
                  className="h-7 w-[66px] min-w-[66px] border-r border-border px-2 text-right text-[9px]"
                >
                  <BiText en="Sites" zh="站点数" className="items-end" />
                </TableHead>,
                <TableHead
                  key={'md-' + year.label}
                  className="h-7 w-[78px] min-w-[78px] border-r border-border px-2 text-right text-[9px]"
                >
                  <BiText en="Mandays" zh="人天" className="items-end" />
                </TableHead>,
                <TableHead
                  key={'cost-' + year.label}
                  className="h-7 w-[112px] min-w-[112px] border-r border-border px-2 text-right text-[9px]"
                >
                  <BiText en="Cost" zh="成本" className="items-end" />
                </TableHead>,
              ])}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const totalSites = totalRowSites(row);
              const totalMandays = totalRowMandays(row);
              const totalCost = totalRowCost(row);
              const invalidValues = rowHasInvalidValues(row);
              const missingMdPerSite = rowMissingMdPerSite(row);
              const unmappedYears = rowUsesUnmappedYears(row);
              const resourceType = resourceTypes.find(
                (item) => item.id === row.reTypeId,
              );
              const valid =
                !invalidValues &&
                !missingMdPerSite &&
                !unmappedYears &&
                Boolean(row.scope.trim()) &&
                Boolean(row.bu.trim()) &&
                Boolean(resourceType);
              return (
                <TableRow
                  key={row.id}
                  className="group h-9 bg-card hover:bg-[#f2f7f6]"
                >
                  <TableCell className="sticky left-0 z-[5] w-[220px] min-w-[220px] border-r border-border bg-card p-0 group-hover:bg-[#f2f7f6]">
                    <Input
                      aria-label={'Scope for row ' + row.id}
                      className={inputClass}
                      title={row.scope}
                      value={row.scope}
                      onChange={(event) =>
                        updateText(row.id, 'scope', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell className="sticky left-[220px] z-[5] w-[150px] min-w-[150px] border-r border-border bg-card p-0 group-hover:bg-[#f2f7f6]">
                    <Input
                      aria-label={'BU for ' + row.id}
                      className={inputClass}
                      title={row.bu}
                      value={row.bu}
                      onChange={(event) =>
                        updateText(row.id, 'bu', event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell className="sticky left-[370px] z-[5] w-[165px] min-w-[165px] border-r border-border bg-card p-0 group-hover:bg-[#f2f7f6]">
                    <Select
                      value={row.reTypeId}
                      onValueChange={(value) =>
                        updateResourceType(row.id, value ?? '')
                      }
                    >
                      <SelectTrigger
                        aria-label={'RE Type for ' + row.id}
                        className="h-9 w-full rounded-none border-0 bg-transparent px-2 text-[10px] shadow-none focus-visible:ring-1"
                      >
                        <SelectValue placeholder="Select / 选择">
                          {resourceType?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {resourceTypes
                          .filter(
                            (item) => item.active || item.id === row.reTypeId,
                          )
                          .map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name}
                              {!item.active ? ' · Inactive' : ''}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="border-r border-border p-0">
                    <Input
                      aria-label={'Mandays per site for ' + row.id}
                      type="number"
                      min="0"
                      step="0.25"
                      className={inputClass + ' text-right'}
                      value={row.mdPerSite}
                      readOnly={row.inputMode === 'mandays'}
                      title={
                        row.inputMode === 'mandays'
                          ? 'Direct MD input / 总人天模式'
                          : 'MD per Site'
                      }
                      onChange={(event) =>
                        updateBase(row.id, Number(event.target.value))
                      }
                    />
                  </TableCell>
                  <TableCell className="financial-numeral border-r border-border bg-[#faf9f6] px-2 text-right font-semibold">
                    {totalSites.toLocaleString('en-SG')}
                  </TableCell>
                  <TableCell className="financial-numeral border-r border-border bg-[#faf9f6] px-2 text-right font-semibold">
                    {totalMandays.toLocaleString('en-SG')}
                  </TableCell>
                  <TableCell className="financial-numeral border-r border-border bg-[#faf9f6] px-2 text-right font-semibold">
                    {formatSgd(totalCost)}
                  </TableCell>
                  {row.years.flatMap((year, yearIndex) => [
                    <TableCell
                      key={'sites-' + row.id + '-' + yearIndex}
                      className="border-r border-border p-0"
                    >
                      <Input
                        aria-label={`${yearColumns[yearIndex]?.label} sites for ${row.id}`}
                        type="number"
                        min="0"
                        step="1"
                        aria-invalid={invalidValues || unmappedYears}
                        className={inputClass + ' text-right'}
                        value={year.sites}
                        readOnly={row.inputMode === 'mandays'}
                        onChange={(event) =>
                          updateYear(
                            row.id,
                            yearIndex,
                            'sites',
                            Number(event.target.value),
                          )
                        }
                      />
                    </TableCell>,
                    <TableCell
                      key={'md-' + row.id + '-' + yearIndex}
                      className="financial-numeral border-r border-border bg-[#f5f7f5] px-2 text-right font-semibold text-[#315764]"
                      title="Calculated as Sites × MD / Site"
                    >
                      {row.inputMode === 'mandays' ? (
                        <Input
                          aria-label={`${yearColumns[yearIndex]?.label} direct mandays for ${row.id}`}
                          type="number"
                          min="0"
                          step="0.0001"
                          value={year.mandays ?? 0}
                          onChange={(event) =>
                            updateYear(
                              row.id,
                              yearIndex,
                              'mandays',
                              Number(event.target.value),
                            )
                          }
                        />
                      ) : (
                        yearRowMandays(row, yearIndex).toLocaleString('en-SG', {
                          maximumFractionDigits: 2,
                        })
                      )}
                    </TableCell>,
                    <TableCell
                      key={'cost-' + row.id + '-' + yearIndex}
                      className="border-r border-border p-0"
                    >
                      <Input
                        aria-label={`${yearColumns[yearIndex]?.label} cost for ${row.id}`}
                        type="number"
                        min="0"
                        step="100"
                        aria-invalid={invalidValues || unmappedYears}
                        className={inputClass + ' text-right'}
                        value={year.cost}
                        readOnly={resourceType?.category === 'internal'}
                        onChange={(event) => {
                          if (resourceType?.category !== 'internal')
                            updateYear(
                              row.id,
                              yearIndex,
                              'cost',
                              Number(event.target.value),
                            );
                        }}
                        onBlur={(event) =>
                          updateYear(
                            row.id,
                            yearIndex,
                            'cost',
                            roundMoney(Number(event.target.value)),
                          )
                        }
                      />
                    </TableCell>,
                  ])}
                  <TableCell className="px-2 text-center">
                    <StatusBadge tone={valid ? 'green' : 'amber'}>
                      <BiInline
                        en={
                          unmappedYears
                            ? 'Set dates'
                            : missingMdPerSite
                              ? 'Enter MD/Site'
                              : invalidValues
                                ? 'Invalid'
                                : !resourceType
                                  ? 'Select RE'
                                  : 'Calculated'
                        }
                        zh={
                          unmappedYears
                            ? '设置交付日期'
                            : missingMdPerSite
                              ? '填写单站人天'
                              : invalidValues
                                ? '数值无效'
                                : !resourceType
                                  ? '选择资源'
                                  : '自动计算'
                        }
                      />
                    </StatusBadge>
                    {missingMdPerSite ? (
                      <span className="mt-1 block text-[8px] text-[#8d5b12]">
                        Sites need MD/Site
                      </span>
                    ) : unmappedYears ? (
                      <span className="mt-1 block text-[8px] text-[#8d5b12]">
                        Delivery year not set
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:bg-[#f7e9e7] hover:text-[#ad4643]"
                      onClick={() => deleteRow(row)}
                      aria-label={`Delete cost row ${row.scope || row.id}`}
                      title="Delete row / 删除行"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="border-t-2 border-[#aaa59a] bg-[#eeece6] font-semibold hover:bg-[#eeece6]">
              <TableCell className="sticky left-0 z-[5] w-[220px] min-w-[220px] border-r border-border bg-[#eeece6] px-2">
                <BiText en="Total" zh="合计" />
              </TableCell>
              <TableCell className="sticky left-[220px] z-[5] w-[150px] min-w-[150px] border-r border-border bg-[#eeece6] px-2 text-[10px] text-muted-foreground">
                All input lines / 全部成本行
              </TableCell>
              <TableCell className="sticky left-[370px] z-[5] w-[165px] min-w-[165px] border-r border-border bg-[#eeece6] px-2 text-[10px] text-muted-foreground">
                {resourceTypes.filter((item) => item.active).length} active
                types
              </TableCell>
              <TableCell className="border-r border-border px-2 text-right">
                —
              </TableCell>
              <TableCell className="financial-numeral border-r border-border px-2 text-right">
                {totals.sites.toLocaleString('en-SG')}
              </TableCell>
              <TableCell className="financial-numeral border-r border-border px-2 text-right">
                {totals.mandays.toLocaleString('en-SG')}
              </TableCell>
              <TableCell className="financial-numeral border-r border-border px-2 text-right">
                {formatSgd(totals.cost)}
              </TableCell>
              {totals.years.flatMap((year, index) => [
                <TableCell
                  key={'total-sites-' + index}
                  className="financial-numeral border-r border-border px-2 text-right"
                >
                  {year.sites.toLocaleString('en-SG')}
                </TableCell>,
                <TableCell
                  key={'total-md-' + index}
                  className="financial-numeral border-r border-border px-2 text-right"
                >
                  {year.mandays.toLocaleString('en-SG')}
                </TableCell>,
                <TableCell
                  key={'total-cost-' + index}
                  className="financial-numeral border-r border-border px-2 text-right"
                >
                  {formatSgd(year.cost)}
                </TableCell>,
              ])}
              <TableCell className="px-2 text-center">
                {allRowsValid ? (
                  <Check className="mx-auto size-4 text-[#377054]" />
                ) : (
                  <AlertTriangle className="mx-auto size-4 text-[#a36b18]" />
                )}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[#f7f5f0] px-4 py-3">
        <div className="text-[10px] leading-4 text-muted-foreground">
          <strong className="text-foreground">Calculation rule:</strong> Enter
          Sites for each year; annual MD = annual Sites × MD / Site. Total Sites
          and Total MD are calculated automatically. Internal cost uses the
          selected RE Type MD rate and annual uplift; subcontract cost remains
          editable.
          <span className="ml-1 text-[9px]">
            计算口径：每年只录入站点数，年度人天 = 年度站点数 ×
            单站人天；内部人力成本按 RE Type
            人天汇率和年度浮动自动计算，分包成本仍可手工输入。
          </span>
        </div>
        <Button
          size="sm"
          onClick={() =>
            announce(
              'Draft is autosaved to local SQLite. / 草稿已自动保存到本地数据库。',
            )
          }
        >
          <Save />
          Save Input Draft{' '}
          <span className="text-[9px] opacity-60">保存草稿</span>
        </Button>
      </div>
    </section>
  );
}
