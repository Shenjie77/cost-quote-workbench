/** Read-only customer quotation content, opened on demand without changing the draft. */
import { useState } from 'react';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { formatSgd } from '@/lib/formatters';
import type { PricingResult } from './domain';
import type { QuoteLine } from './excel-template-types';
import type { QuoteAssumption, QuoteTemplate } from './types';

const unitPriceFormat = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Preserve the supported four-decimal selling rate instead of rounding it upward to cents. */
function formatUnitPrice(value: number): string {
  return Number.isFinite(value) ? `S$ ${unitPriceFormat.format(value)}` : '—';
}

/** Keep only local visibility state; customer fields are read from the current calculated draft. */
export function QuotePreviewDialog({
  project,
  activeVersion,
  template,
  pricing,
  lines,
  assumptions,
}: {
  project: Readonly<CostExportSnapshot['project']>;
  activeVersion: string;
  template?: Readonly<QuoteTemplate>;
  pricing: Readonly<PricingResult>;
  lines: readonly Readonly<QuoteLine>[];
  assumptions: readonly Readonly<QuoteAssumption>[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Client Output Preview 客户预览"
        render={<Button variant="outline" />}
      >
        <Eye /> Preview
        <span className="text-xs opacity-60">客户预览</span>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Client Output Preview</DialogTitle>
          <DialogDescription className="text-xs">
            Review the current quotation content. The generated XLSX uses the
            selected customer template.
          </DialogDescription>
        </DialogHeader>
        {!pricing.valid && (
          <p
            role="alert"
            className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            Draft has unresolved pricing:{' '}
            {pricing.errors[0] ||
              'Resolve pricing errors before generating the customer quotation.'}
          </p>
        )}
        {/* Only customer-facing fields are rendered; cost, allocation weights and pricing controls stay outside. */}
        <article
          aria-label="Customer quotation preview"
          className="min-h-0 overflow-auto border bg-card p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-primary pb-3">
            <h3 className="text-base font-bold tracking-wide text-primary">
              {template?.documentTitle || 'SERVICE QUOTATION'}
            </h3>
            <span className="financial-numeral text-xs text-muted-foreground">
              QT-{project.id.replace(/^PRJ-/, '')}-{activeVersion}
            </span>
          </div>
          <div className="my-3">
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Prepared for
            </p>
            <p className="mt-1 text-sm font-semibold">{project.client}</p>
            <p className="mt-1 text-xs text-muted-foreground">{project.name}</p>
          </div>
          {/* Line amounts share the same calculated source as the customer workbook. */}
          <Table
            className="min-w-[600px] text-xs"
            aria-label="Customer quotation details"
          >
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="w-10">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.id}>
                  <TableCell className="align-top text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-pre-wrap break-words">
                    {line.description}
                  </TableCell>
                  <TableCell className="financial-numeral text-right align-top">
                    {line.quantity}
                  </TableCell>
                  <TableCell className="align-top">{line.unit}</TableCell>
                  <TableCell className="financial-numeral text-right align-top">
                    {formatUnitPrice(line.unitPrice)}
                  </TableCell>
                  <TableCell className="financial-numeral text-right align-top">
                    {formatSgd(line.amount)}
                  </TableCell>
                </TableRow>
              ))}
              {!lines.length && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-4 text-center text-muted-foreground"
                  >
                    No quotation details yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {/* Show the complete reconciliation from service price to tax-inclusive customer total. */}
          <dl className="ml-auto mt-3 grid max-w-sm grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-y py-3 text-xs">
            <dt>Service price</dt>
            <dd className="financial-numeral text-right">
              {formatSgd(pricing.listPrice)}
            </dd>
            <dt>Discount</dt>
            <dd className="financial-numeral text-right">
              {formatSgd(pricing.discount)}
            </dd>
            <dt className="font-semibold">Total Before Tax</dt>
            <dd className="financial-numeral text-right text-base font-bold text-primary">
              {formatSgd(pricing.quoteBeforeTax)}
            </dd>
            <dt className="text-muted-foreground">
              GST {pricing.gstPercent.toFixed(2)}%
            </dt>
            <dd className="financial-numeral text-right text-muted-foreground">
              {formatSgd(pricing.gstAmount)}
            </dd>
            <dt className="font-semibold">Total After Tax</dt>
            <dd className="financial-numeral text-right font-semibold">
              {formatSgd(pricing.quoteAfterTax)}
            </dd>
          </dl>
          {/* Preserve selected terms and included assumptions verbatim, including their line breaks. */}
          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
            <p>• Validity: {template?.validityDays || 30} days</p>
            <p className="whitespace-pre-wrap break-words">
              • Payment: {template?.paymentTerms || 'Not set'}
            </p>
            <p>• Cost baseline: {activeVersion}</p>
            {template?.termsAndConditions && (
              <div className="border-t pt-2">
                <p className="font-semibold">Terms &amp; Conditions</p>
                <p className="whitespace-pre-wrap break-words">
                  {template.termsAndConditions}
                </p>
              </div>
            )}
            {assumptions
              .filter((row) => row.included)
              .map((row) => (
                <p className="whitespace-pre-wrap break-words" key={row.id}>
                  • {row.text}
                </p>
              ))}
          </div>
        </article>
        <DialogFooter className="py-3" showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
