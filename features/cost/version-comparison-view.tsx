/** Real version comparison calculated from each independent input snapshot. */

import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  getCostStatementValues,
  getHQTravelSummary,
  totalRowMandays,
  type CostVersionState,
  type CostVersionSnapshot,
  type ResourceType,
} from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';

export function VersionComparisonView({
  lockReasons = {},
  deletionReasons = {},
  onDeleteVersion,
  versions,
  activeVersion,
  resourceTypes,
  onSelectVersion,
  onUpdateVersionState,
}: {
  lockReasons?: Record<string, string>;
  deletionReasons?: Record<string, string>;
  onDeleteVersion?: (version: string) => void;
  versions: CostVersionSnapshot[];
  activeVersion: string;
  resourceTypes: ResourceType[];
  onSelectVersion: (version: string) => void;
  onUpdateVersionState: (version: string, state: CostVersionState) => void;
}) {
  const records = versions.map((version) => {
    const travel = getHQTravelSummary(
      version.costRows,
      version.resourceTypes || resourceTypes,
      version.travelSettings,
    ).totalCost;
    const total = getCostStatementValues(
      version.costRows,
      version.resourceTypes || resourceTypes,
      travel,
      version.manualCosts,
      version.subcontractCost,
    ).totalWithRisk;
    const previous = versions.find(
      (item) => item.code === version.sourceVersion,
    );
    let previousTotal = 0;
    if (previous) {
      const previousTravel = getHQTravelSummary(
        previous.costRows,
        previous.resourceTypes || resourceTypes,
        previous.travelSettings,
      ).totalCost;
      previousTotal = getCostStatementValues(
        previous.costRows,
        previous.resourceTypes || resourceTypes,
        previousTravel,
        previous.manualCosts,
        previous.subcontractCost,
      ).totalWithRisk;
    }
    return {
      ...version,
      total,
      mandays: version.costRows.reduce(
        (sum, row) => sum + totalRowMandays(row),
        0,
      ),
      delta: previous ? total - previousTotal : null,
    };
  });

  return (
    <section className="overflow-hidden border border-border bg-card">
      <SectionHeading
        index="03"
        title="Version Comparison"
        titleZh="版本对比"
        description="Each row is calculated from that version's stored cost inputs."
        descriptionZh="每一行均使用该版本独立保存的成本输入重新计算。"
      />
      <Table>
        <TableHeader>
          <TableRow className="bg-[#f2f0ea] hover:bg-[#f2f0ea]">
            <TableHead className="px-4">
              <BiText en="Version" zh="版本" />
            </TableHead>
            <TableHead>
              <BiText en="State" zh="状态" />
            </TableHead>
            <TableHead>
              <BiText en="Source" zh="来源版本" />
            </TableHead>
            <TableHead className="text-right">
              <BiText en="Mandays" zh="总人天" className="items-end" />
            </TableHead>
            <TableHead className="text-right">
              <BiText en="Total Cost" zh="总成本" className="items-end" />
            </TableHead>
            <TableHead className="pr-4 text-right">
              <BiText
                en="Change vs Source"
                zh="相对来源版本变化"
                className="items-end"
              />
            </TableHead>
            <TableHead className="w-48 pr-4 text-right">
              <BiText en="Action" zh="操作" className="items-end" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.code} className="h-12">
              <TableCell className="financial-numeral px-4 font-semibold text-[#173a52]">
                {record.code}
                {record.code === activeVersion ? (
                  <span className="ml-2 text-[8px] text-[#2e6f77]">
                    ACTIVE · 当前
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <Select
                  disabled={record.state === 'Confirmed'}
                  value={record.state}
                  onValueChange={(value) => {
                    if (
                      value &&
                      record.state !== 'Confirmed' &&
                      (!lockReasons[record.code] || value === 'Confirmed')
                    ) {
                      onUpdateVersionState(
                        record.code,
                        value as CostVersionState,
                      );
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="min-w-[122px] bg-white text-[10px]"
                    aria-label={`${record.code} version status`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['Draft', 'Suspended', 'Confirmed'] as const).map(
                      (state) => (
                        <SelectItem
                          key={state}
                          value={state}
                          disabled={
                            !!lockReasons[record.code] && state !== 'Confirmed'
                          }
                        >
                          <BiInline
                            en={state}
                            zh={
                              state === 'Confirmed'
                                ? '已定稿'
                                : state === 'Suspended'
                                  ? '暂停'
                                  : '草稿'
                            }
                          />
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="financial-numeral text-[10px] text-muted-foreground">
                {record.sourceVersion || '—'}
              </TableCell>
              <TableCell className="financial-numeral text-right">
                {record.mandays.toLocaleString('en-SG')}
              </TableCell>
              <TableCell className="financial-numeral text-right font-semibold">
                {formatSgd(record.total)}
              </TableCell>
              <TableCell
                className={
                  'financial-numeral pr-4 text-right font-semibold ' +
                  (Number(record.delta || 0) > 0
                    ? 'text-[#a86432]'
                    : 'text-[#377054]')
                }
              >
                {record.delta === null
                  ? '—'
                  : `${record.delta > 0 ? '+' : ''}${formatSgd(record.delta)}`}
              </TableCell>
              <TableCell className="pr-4 text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant={
                      record.code === activeVersion ? 'ghost' : 'outline'
                    }
                    size="sm"
                    disabled={record.code === activeVersion}
                    onClick={() => onSelectVersion(record.code)}
                  >
                    {record.code === activeVersion ? 'Current' : 'Open'}
                    <span className="text-[8px] opacity-60">
                      {record.code === activeVersion ? '当前' : '查看'}
                    </span>
                    {record.code === activeVersion ? null : <ArrowRight />}
                  </Button>
                  {record.state === 'Suspended' && onDeleteVersion ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-red-700"
                      disabled={!!deletionReasons[record.code]}
                      title={
                        deletionReasons[record.code] ||
                        '删除暂停版本，保留历史记录'
                      }
                      onClick={() => onDeleteVersion(record.code)}
                    >
                      Delete <span className="text-[8px] opacity-60">删除</span>
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
