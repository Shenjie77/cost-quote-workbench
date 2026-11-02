'use client';

import { Text, Surface } from '@/components/ui/presentation';
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
  requiredSheets = [],
  triggerLabel = 'Simple Export',
  title = 'Simple Cost Export',
  description = 'Choose worksheets / 选择导出页签。Cost Detail follows the current view; summaries include all five years.',
}: {
  disabled: boolean;
  getSheets: () => SheetOption[];
  onExport: (sheets: readonly SimpleCostSheetId[]) => Promise<boolean>;
  requiredSheets?: readonly SimpleCostSheetId[];
  triggerLabel?: string;
  title?: string;
  description?: string;
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
    if (inFlight.current || requiredSheets.includes(sheetId)) return;
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
        render={<Button size="sm" />}
        disabled={disabled}
        title={`Choose the worksheets to include in ${title}`}
      >
        <Download /> {triggerLabel}
      </DialogTrigger>
      <DialogContent
        size="md"
        className="flex flex-col gap-3 overflow-hidden"
        showCloseButton={!exporting}
        aria-busy={exporting}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text as="output" tone="muted" textRole="body-small">
            {selected.length} / {options.length} selected
          </Text>
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
              onClick={() =>
                setSelected(
                  options
                    .filter((sheet) => requiredSheets.includes(sheet.id))
                    .map((sheet) => sheet.id),
                )
              }
            >
              Clear
            </Button>
          </div>
        </div>
        {/* A regular scroll container clips fieldset content reliably above the fixed footer. */}
        <Surface as="div" variant="panel" className="min-h-0 overflow-y-auto">
          <fieldset className="min-w-0" disabled={exporting}>
            <legend className="sr-only">Worksheets to export</legend>
            {options.map((sheet, index) => (
              <Surface
                key={sheet.id}
                htmlFor={`${id}-sheet-${index}`}
                as="label"
                variant="field"
                className="grid cursor-pointer grid-cols-[1rem_1fr] items-center"
              >
                <Checkbox
                  id={`${id}-sheet-${index}`}
                  aria-label={sheet.label}
                  aria-describedby={`${id}-description-${index}`}
                  checked={selected.includes(sheet.id)}
                  disabled={exporting || requiredSheets.includes(sheet.id)}
                  onCheckedChange={(checked) => toggleSheet(sheet.id, checked)}
                />
                <span className="min-w-0">
                  <Text as="span" textRole="body-main" className="block">
                    {sheet.label}
                    {requiredSheets.includes(sheet.id) && (
                      <Text
                        as="span"
                        tone="muted"
                        textRole="body-small"
                        className="ml-2"
                      >
                        Required / 必选
                      </Text>
                    )}
                  </Text>
                  <Text
                    id={`${id}-description-${index}`}
                    as="span"
                    tone="muted"
                    textRole="body-small"
                    className="block"
                  >
                    {sheet.description}
                  </Text>
                </span>
              </Surface>
            ))}
          </fieldset>
        </Surface>
        {!selected.length && !error && (
          <Text as="output" tone="muted" textRole="body-small">
            Select at least one worksheet. / 请至少选择一个页签。
          </Text>
        )}
        {error && (
          <Text role="alert" as="p" tone="danger" textRole="body-small">
            {error}
          </Text>
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
