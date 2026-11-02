import { Surface, Text } from '@/components/ui/presentation';
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
  getY1Year,
  getCostStatementValues,
  getHQTravelSummary,
  totalRowMandays,
  type CostVersionState,
  type CostVersionSnapshot,
  type ResourceType,
} from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';

/** Compare stored versions without changing their independent calculation basis. */
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
      getY1Year(version.rateSettings),
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
        getY1Year(previous.rateSettings),
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
    <Surface as="section" variant="panel" className="min-w-0 overflow-hidden">
      <SectionHeading
        index="03"
        title="Version Comparison"
        titleZh="版本对比"
        description="Each row is calculated from that version's stored cost inputs."
        descriptionZh="每一行均使用该版本独立保存的成本输入重新计算。"
      />
      <Table className="min-w-[840px]">
        <TableHeader>
          <TableRow tone="subtotal">
            <TableHead>
              <BiText en="Version" zh="版本" />
            </TableHead>
            <TableHead>
              <BiText en="State" zh="状态" />
            </TableHead>
            <TableHead>
              <BiText en="Source" zh="来源版本" />
            </TableHead>
            <TableHead variant="numeric" className="text-right">
              <BiText en="Mandays" zh="总人天" className="items-end" />
            </TableHead>
            <TableHead variant="numeric" className="text-right">
              <BiText en="Total Cost" zh="总成本" className="items-end" />
            </TableHead>
            <TableHead variant="numeric" className="text-right">
              <BiText
                en="Change vs Source"
                zh="相对来源版本变化"
                className="items-end"
              />
            </TableHead>
            <TableHead variant="numeric" className="w-48 text-right">
              <BiText en="Action" zh="操作" className="items-end" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.code} className="h-12">
              <TableCell className="financial-numeral">
                {record.code}
                {record.code === activeVersion ? (
                  <Text
                    as="span"
                    tone="primary"
                    textRole="body-small"
                    className="ml-2"
                  >
                    ACTIVE · 当前
                  </Text>
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
                    className="min-w-[122px]"
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
              <TableCell className="financial-numeral">
                {record.sourceVersion || '—'}
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {record.mandays.toLocaleString('en-SG')}
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {formatSgd(record.total)}
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {record.delta === null
                  ? '—'
                  : `${record.delta > 0 ? '+' : ''}${formatSgd(record.delta)}`}
              </TableCell>
              <TableCell variant="numeric" className="text-right">
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
                    <Text as="span" textRole="body-small">
                      {record.code === activeVersion ? '当前' : '查看'}
                    </Text>
                    {record.code === activeVersion ? null : <ArrowRight />}
                  </Button>
                  {record.state === 'Suspended' && onDeleteVersion ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"

                      disabled={!!deletionReasons[record.code]}
                      title={
                        deletionReasons[record.code] ||
                        '删除暂停版本，保留历史记录'
                      }
                      onClick={() => onDeleteVersion(record.code)}
                    >
                      Delete{' '}
                      <Text as="span" textRole="body-small">
                        删除
                      </Text>
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Surface>
  );
}
