import { Text, Surface } from '@/components/ui/presentation';
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
      <DialogContent size="md">
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
        <Text as="p" textRole="body-main">
          Draft files are marked DRAFT. Final output requires a confirmed cost
          version and completed quotation approval where applicable.
        </Text>
        {errors.length > 0 && (
          <Surface
            role="alert"
            as="div"
            variant="notice"
            tone="danger"
            textRole="body-main"
            className="max-h-52 overflow-auto"
          >
            <p>Resolve before exporting</p>
            <Surface
              as="ul"
              variant="body"
              className="mt-2 list-disc space-y-1"
            >
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </Surface>
          </Surface>
        )}
        {finalErrors.length > 0 && (
          <Surface
            as="div"
            variant="notice"
            tone="warning"
            textRole="body-main"
          >
            <p>Final quotation not ready</p>
            <Surface
              as="ul"
              variant="body"
              className="mt-2 list-disc space-y-1"
            >
              {finalErrors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </Surface>
            <p className="mt-2">
              You can export a draft once the input issues above are resolved.
            </p>
          </Surface>
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
