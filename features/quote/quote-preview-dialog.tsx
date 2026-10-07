import {
  structuredBodyRows,
  defaultBodyTitles,
  type BodyRow,
} from './structured-body';
import { buildQuotePreviewWorkbook } from './preview-workbook';
import { readableFileStem, exportTimestamp } from '@/lib/file-names';
import { quotationProjectName } from './template-text';
import { quoteFieldValues } from './document-fields';
import { groupedLines, quotationSections } from './quotation-groups';
/** Read-only customer quotation content, opened on demand without changing the draft. */
import { useRef, useState } from 'react';
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
import {
  isRetiredQuoteAssumption,
  type QuoteAssumption,
  type QuoteTemplate,
} from './types';

const unitPriceFormat = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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
  maintenanceLines = [],
  maintenanceAmount = 0,
}: {
  project: Readonly<CostExportSnapshot['project']>;
  activeVersion: string;
  template?: Readonly<QuoteTemplate>;
  pricing: Readonly<PricingResult>;
  lines: readonly Readonly<QuoteLine>[];
  assumptions: readonly Readonly<QuoteAssumption>[];
  maintenanceLines?: readonly Readonly<QuoteLine>[];
  maintenanceAmount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState('');
  const exportLock = useRef(false);
  const customerName = quotationProjectName({ project, pricing });
  const sections = quotationSections(
    groupedLines([...lines, ...maintenanceLines], pricing.lineGroups),
  );
  const optionalAmount = sections
    .filter((s) => s.inclusion === 'optional')
    .flatMap((s) => s.lines)
    .reduce((sum, l) => sum + l.amount, 0);

  let renderedTerms = template?.termsAndConditions ?? '',
    termsError = '';
  let bodyRows: BodyRow[] = [];
  if (template)
    try {
      const previewInput = {
        project,
        pricing,
        template,
        quoteNumber: `QT-${project.id.replace(/^PRJ-/, '')}-${activeVersion}`,
        costVersion: activeVersion,
        assumptions: [...assumptions],
        lines: [...lines],
        pricedMaintenanceLines: [...maintenanceLines],
        layout: 'customer' as const,
      };
      const values = quoteFieldValues(previewInput);
      renderedTerms = String(values.termsAndConditions ?? '');
      bodyRows = structuredBodyRows(
        previewInput,
        template.excel?.body ?? {
          startRow: 1,
          endRow: 1,
          styles: { chapter: 1, category: 1, detail: 1, subtotal: 1, total: 1 },
          numbering: 'hierarchical',
          categoryOrder: [],
          titles: defaultBodyTitles,
        },
        values,
      );
    } catch (error) {
      termsError =
        error instanceof Error ? error.message : 'Check T&C placeholders.';
    }

  const sectionName = (inclusion: 'mandatory' | 'optional') =>
    pricing.sectionNames?.[inclusion] ||
    template?.excel?.body?.sectionNames?.[inclusion] ||
    (inclusion === 'mandatory' ? 'Mandatory' : 'Optional');
  async function exportPreview() {
    if (exportLock.current || !pricing.valid || termsError || !template) return;
    exportLock.current = true;
    setExporting(true);
    setExportError('');
    const input = {
      title: template.documentTitle || 'SERVICE QUOTATION',
      sectionNames: {
        mandatory: sectionName('mandatory'),
        optional: sectionName('optional'),
      },
      projectName: customerName,
      client: project.client,
      currency: project.currency,
      quoteNumber: `QT-${project.id.replace(/^PRJ-/, '')}-${activeVersion}`,
      costVersion: activeVersion,
      sections: sections.map((section) => ({
        name: `${section.section || sectionName(section.inclusion)} / ${section.category}`,
        lines: section.lines,
      })),
      bodyRows,
      servicePrice: pricing.listPrice,
      maintenanceAmount,
      discount: pricing.discount,
      optionalAmount,
      validityDays: template.validityDays || 30,
      paymentTerms: template.paymentTerms,
      terms: renderedTerms,
      assumptions: assumptions
        .filter((row) => row.included && !isRetiredQuoteAssumption(row))
        .map((row) => row.text),
    };
    try {
      const bytes = await buildQuotePreviewWorkbook(input);
      const blob = new Blob([new Uint8Array(bytes)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Preview_${readableFileStem(input.projectName)}_${exportTimestamp()}.xlsx`;
      try {
        anchor.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : 'Unable to export preview.',
      );
    } finally {
      exportLock.current = false;
      setExporting(false);
    }
  }

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
            Review the current quotation content. Preview XLSX uses this
            built-in layout; customer exports use the selected customer
            template.
          </DialogDescription>
        </DialogHeader>
        {termsError && (
          <p role="alert" className="text-xs text-destructive">
            {termsError}
          </p>
        )}
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
            <p className="mt-1 text-xs text-muted-foreground">{customerName}</p>
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
              {bodyRows.map((row, index) =>
                row.role === 'blank' ? (
                  <TableRow key={index} aria-hidden="true">
                    <TableCell colSpan={6} className="h-3 p-0" />
                  </TableRow>
                ) : (
                  <TableRow
                    key={index}
                    className={
                      row.role === 'total' || row.role === 'grandTotal'
                        ? 'bg-accent/50 font-semibold'
                        : row.role !== 'detail'
                          ? 'font-medium'
                          : ''
                    }
                  >
                    <TableCell>{row.number}</TableCell>
                    <TableCell
                      colSpan={row.line ? 1 : 4}
                      className="min-w-48 whitespace-pre-wrap break-words"
                    >
                      {row.description}
                    </TableCell>
                    {row.line && (
                      <>
                        <TableCell className="text-right">
                          {row.line.quantity}
                        </TableCell>
                        <TableCell>{row.line.unit}</TableCell>
                        <TableCell className="text-right">
                          {formatUnitPrice(row.line.unitPrice)}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      {row.amount === undefined ? '' : formatSgd(row.amount)}
                    </TableCell>
                  </TableRow>
                ),
              )}
              {!sections.length && (
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
                  {renderedTerms}
                </p>
              </div>
            )}
            {assumptions
              .filter((row) => row.included && !isRetiredQuoteAssumption(row))
              .map((row) => (
                <p className="whitespace-pre-wrap break-words" key={row.id}>
                  • {row.text}
                </p>
              ))}
          </div>
        </article>
        {exportError && (
          <p role="alert" className="text-xs text-destructive">
            {exportError}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Built-in preview layout. Edit content in Quotation project name, Quote
          Templates (title and T&amp;C), and Quote Assumptions.
        </p>
        <DialogFooter className="py-3" showCloseButton>
          <Button
            disabled={exporting || !pricing.valid || !!termsError || !template}
            onClick={exportPreview}
          >
            {exporting ? 'Exporting…' : 'Export Preview XLSX'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
