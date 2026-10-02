import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

/** Drafts remain visibly separate from final documents and cannot bypass invalid amounts. */
export function QuoteExportDialog({
  open,
  onOpenChange,
  errors,
  finalErrors,
  busy,
  onExport,
  templateLayout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: string[];
  finalErrors: string[];
  busy: boolean;
  onExport: (status: 'Draft' | 'Final') => void;
  templateLayout?: 'body' | 'regions' | 'rows';
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Export customer quotation</DialogTitle>
          <DialogDescription>
            {templateLayout === 'body'
              ? 'Uses your workbook styles with generated chapters, category titles, numbering and totals. Empty chapters, including their totals, are removed.'
              : templateLayout === 'regions'
                ? 'Uses your uploaded workbook, saved module regions and cell placeholders. Empty modules are removed automatically.'
                : templateLayout === 'rows'
                  ? 'Uses your uploaded workbook and saved cell content. This single-row mapping exports professional services; configure module regions to include maintenance.'
                  : 'Standard XLSX with professional services, maintenance, totals, assumptions and commercial terms. Uses the applied template’s wording.'}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          Draft files are marked DRAFT. Final output requires a confirmed cost
          version and completed quotation approval where applicable.
        </p>
        {errors.length > 0 && (
          <div
            role="alert"
            className="max-h-52 overflow-auto rounded border border-red-200 bg-red-50 p-3 text-sm"
          >
            <p className="font-semibold">Resolve before exporting</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}
        {finalErrors.length > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="font-semibold">Final quotation not ready</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {finalErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
            <p className="mt-2">
              You can export a draft once the input issues above are resolved.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || errors.length > 0}
            onClick={() => onExport('Draft')}
          >
            Export Draft XLSX
          </Button>
          <Button
            disabled={busy || errors.length > 0 || finalErrors.length > 0}
            onClick={() => onExport('Final')}
          >
            {busy ? 'Exporting…' : 'Export Final XLSX'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
