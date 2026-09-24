'use client';

import { useId, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type {
  getAvailableSimpleCostSheets,
  SimpleCostSheetId,
} from '@/features/cost/simple-export-sheets';

type SheetOption = ReturnType<typeof getAvailableSimpleCostSheets>[number];

/** Select workbook tabs locally; opening, checking or cancelling never changes project data. */
export function SimpleCostExportDialog({
  disabled,
  getSheets,
  onExport,
}: {
  disabled: boolean;
  getSheets: () => SheetOption[];
  onExport: (sheets: readonly SimpleCostSheetId[]) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SheetOption[]>([]);
  const [selected, setSelected] = useState<SimpleCostSheetId[]>([]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  /** Start each export with all currently available tabs, including applicable Subcon tabs. */
  const changeOpen = (next: boolean) => {
    if (inFlight.current || (next && disabled)) return;
    if (next) {
      try {
        const available = getSheets();
        setOptions(available);
        setSelected(available.map((sheet) => sheet.id));
        setError('');
      } catch (cause) {
        // Keep the dialog dismissible when a snapshot cannot be read; reopening retries discovery.
        setOptions([]);
        setSelected([]);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to read worksheets. Please close and try again.',
        );
      }
    }
    setOpen(next);
  };

  /** Keep selection unique without changing workbook order or any calculation inputs. */
  const toggleSheet = (sheetId: SimpleCostSheetId, checked: boolean) => {
    if (inFlight.current) return;
    setSelected((current) =>
      checked
        ? [...new Set([...current, sheetId])]
        : current.filter((item) => item !== sheetId),
    );
    setError('');
  };

  /** Submit once, retaining the selection and a retry path if generation or archiving fails. */
  const confirmExport = async () => {
    if (!selected.length || disabled || inFlight.current) return;
    inFlight.current = true;
    setExporting(true);
    setError('');
    try {
      if (await onExport([...selected])) setOpen(false);
      else
        setError(
          'Export failed. Check the cost data and try again. / 导出失败，请检查成本数据后重试。',
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Export failed. Please try again.',
      );
    } finally {
      inFlight.current = false;
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={<Button size="sm" className="h-8 px-2.5 text-xs" />}
        disabled={disabled}
        title="Choose the worksheets to include in Simple Cost Export"
      >
        <Download /> Simple Export
      </DialogTrigger>
      <DialogContent
        className="flex flex-col gap-3 overflow-hidden sm:max-w-[560px]"
        showCloseButton={!exporting}
        aria-busy={exporting}
      >
        <DialogHeader>
          <DialogTitle>Simple Cost Export</DialogTitle>
          <DialogDescription className="text-xs">
            Choose worksheets / 选择导出页签。Cost Detail follows the current
            view; summaries include all five years.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <output className="text-xs text-muted-foreground">
            {selected.length} / {options.length} selected
          </output>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting || selected.length === options.length}
              onClick={() => setSelected(options.map((sheet) => sheet.id))}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={exporting || !selected.length}
              onClick={() => setSelected([])}
            >
              Clear
            </Button>
          </div>
        </div>
        {/* A regular scroll container clips fieldset content reliably above the fixed footer. */}
        <div className="min-h-0 overflow-y-auto rounded-md border">
          <fieldset className="min-w-0" disabled={exporting}>
            <legend className="sr-only">Worksheets to export</legend>
            {options.map((sheet, index) => (
              <label
                key={sheet.id}
                htmlFor={`${id}-sheet-${index}`}
                className="grid cursor-pointer grid-cols-[1rem_1fr] items-center gap-x-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50 focus-within:bg-muted/50"
              >
                <Checkbox
                  id={`${id}-sheet-${index}`}
                  aria-label={sheet.label}
                  aria-describedby={`${id}-description-${index}`}
                  checked={selected.includes(sheet.id)}
                  disabled={exporting}
                  onCheckedChange={(checked) => toggleSheet(sheet.id, checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {sheet.label}
                  </span>
                  <span
                    id={`${id}-description-${index}`}
                    className="block text-xs text-muted-foreground"
                  >
                    {sheet.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        {!selected.length && !error && (
          <output className="text-xs text-muted-foreground">
            Select at least one worksheet. / 请至少选择一个页签。
          </output>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            disabled={exporting}
            onClick={() => changeOpen(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={exporting || disabled || !selected.length}
            onClick={() => void confirmExport()}
          >
            <Download />
            {exporting
              ? 'Exporting…'
              : `Export ${selected.length} ${selected.length === 1 ? 'sheet' : 'sheets'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
