import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
import { RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PricingResult } from './domain';
import { formatSgd } from '@/lib/formatters';

/** Displays the captured rate allocation; master-data changes require explicit application. */
export function ProfitShareSummary({
  result,
  masterDataRevision,
  onManage,
  onApply,
  applying,
  disabled,
}: {
  result: PricingResult;
  masterDataRevision?: number;
  onManage: () => void;
  onApply?: () => Promise<void>;
  applying: boolean;
  disabled: boolean;
}) {
  return (
    <Surface aria-label="Profit share allocation" as="div" variant="inset">
      <Surface
        as="div"
        variant="body"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <div>
          <p>
            Profit Share Rate{' '}
            <Text as="span" tone="primary" className="financial-numeral ml-2">
              {result.weightedProfitShareRate.toFixed(2)}%
            </Text>
          </p>
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            {masterDataRevision === undefined
              ? 'No master data revision applied'
              : `Applied Master Data · Revision ${masterDataRevision}`}
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"

            disabled={disabled || applying}
            onClick={onManage}
          >
            <Settings2 /> Manage Rates
          </Button>
          {onApply && (
            <Button
              size="sm"
              variant="outline"

              disabled={disabled || applying}
              onClick={() => void onApply()}
            >
              <RefreshCw className={applying ? 'animate-spin' : undefined} />{' '}
              {applying ? 'Applying…' : 'Apply Latest Master Data'}
            </Button>
          )}
        </div>
      </Surface>
      {!!result.profitShareBreakdown.length && (
        <div className="mt-2 wb-table-scroll">
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">BU</TableHead>
                <TableHead variant="numeric" className="h-8 text-right">
                  Cost
                </TableHead>
                <TableHead variant="numeric" className="h-8 text-right">
                  Weight
                </TableHead>
                <TableHead variant="numeric" className="h-8 text-right">
                  Rate
                </TableHead>
                <TableHead variant="numeric" className="h-8 text-right">
                  Share
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.profitShareBreakdown.map((row) => (
                <TableRow key={row.bu}>
                  <TableCell>
                    {row.bu}
                    {row.unassignedCost > 0 && (
                      <Text as="small" tone="muted" className="mt-1 block">
                        Includes {formatSgd(row.unassignedCost)} without BU
                      </Text>
                    )}
                  </TableCell>
                  <TableCell
                    variant="numeric"
                    className="financial-numeral text-right"
                  >
                    {formatSgd(row.cost)}
                  </TableCell>
                  <TableCell
                    variant="numeric"
                    className="financial-numeral text-right"
                  >
                    {(row.costWeight * 100).toFixed(2)}%
                  </TableCell>
                  <TableCell
                    variant="numeric"
                    className="financial-numeral text-right"
                  >
                    {row.ratePercent.toFixed(2)}%
                    {!row.configured && (
                      <small className="block">Not configured</small>
                    )}
                  </TableCell>
                  <TableCell
                    variant="numeric"
                    className="financial-numeral text-right"
                  >
                    {formatSgd(row.profitShareAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Surface
        as="div"
        variant="body"
        textRole="body-small"
        className="flex items-center justify-between gap-3"
      >
        <span>Profit Share Amount</span>
        <span className="financial-numeral">
          {formatSgd(result.profitShareAmount)}
        </span>
      </Surface>
      <Disclosure>
        <DisclosureSummary className="cursor-pointer">
          Calculation notes / 计算说明
        </DisclosureSummary>
        <p className="mt-1">
          Rates are weighted by BU cost. Costs without a BU, including EHS and
          Risk, are assigned to the largest BU. Sales GP = (price − cost −
          profit share) / price.
        </p>
      </Disclosure>
      {!!result.warnings.length && (
        <Surface
          as="output"
          variant="notice"
          tone="warning"
          textRole="body-small"
          className="mx-3 mb-2 block"
        >
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </Surface>
      )}
    </Surface>
  );
}
