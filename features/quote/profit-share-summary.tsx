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
    <div aria-label="Profit share allocation" className="bg-muted/10">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div>
          <p className="font-semibold">
            Profit Share Rate{' '}
            <span className="financial-numeral ml-2 text-[#173a52]">
              {result.weightedProfitShareRate.toFixed(2)}%
            </span>
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {masterDataRevision === undefined
              ? 'No master data revision applied'
              : `Applied Master Data · Revision ${masterDataRevision}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            disabled={disabled || applying}
            onClick={onManage}
          >
            <Settings2 /> Manage Rates
          </Button>
          {onApply && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={disabled || applying}
              onClick={() => void onApply()}
            >
              <RefreshCw className={applying ? 'animate-spin' : undefined} />{' '}
              {applying ? 'Applying…' : 'Apply Latest Master Data'}
            </Button>
          )}
        </div>
      </div>
      {!!result.profitShareBreakdown.length && (
        <div className="mt-3 overflow-x-auto">
          <Table className="min-w-[420px] text-[10px]">
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 pl-4">BU</TableHead>
                <TableHead className="h-7 text-right">Cost</TableHead>
                <TableHead className="h-7 text-right">Weight</TableHead>
                <TableHead className="h-7 text-right">Rate</TableHead>
                <TableHead className="h-7 pr-4 text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.profitShareBreakdown.map((row) => (
                <TableRow key={row.bu}>
                  <TableCell className="py-1.5 pl-4 font-medium">
                    {row.bu}
                    {row.unassignedCost > 0 && (
                      <small className="mt-0.5 block font-normal text-muted-foreground">
                        Includes {formatSgd(row.unassignedCost)} without BU
                      </small>
                    )}
                  </TableCell>
                  <TableCell className="financial-numeral py-1.5 text-right">
                    {formatSgd(row.cost)}
                  </TableCell>
                  <TableCell className="financial-numeral py-1.5 text-right">
                    {(row.costWeight * 100).toFixed(2)}%
                  </TableCell>
                  <TableCell
                    className={`financial-numeral py-1.5 text-right ${!row.configured ? 'text-amber-700' : ''}`}
                  >
                    {row.ratePercent.toFixed(2)}%
                    {!row.configured && (
                      <small className="block">Not configured</small>
                    )}
                  </TableCell>
                  <TableCell className="financial-numeral py-1.5 pr-4 text-right">
                    {formatSgd(row.profitShareAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[11px]">
        <span>Profit Share Amount</span>
        <span className="financial-numeral font-semibold">
          {formatSgd(result.profitShareAmount)}
        </span>
      </div>
      <p className="px-4 pb-2 text-[10px] text-muted-foreground">
        Rates are weighted by BU cost. Costs without a BU, including EHS and
        Risk, are assigned to the largest BU. Sales GP = (price − cost − profit
        share) / price.
      </p>
      {!!result.warnings.length && (
        <output className="mx-4 mb-3 block border-l-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </output>
      )}
    </div>
  );
}
