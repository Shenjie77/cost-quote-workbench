'use client';
/** Preview and atomically append clipboard rows using the same annual-price rules as the grid. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { parseMaintenanceBulk } from './bulk-entry';
import type { BoqLine } from './domain';

export function MaintenanceBulkDialog({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (rows: BoqLine[]) => boolean;
}) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState('');
  const [preview, setPreview] = useState<ReturnType<
    typeof parseMaintenanceBulk
  > | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setText('');
          setPreview(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        Bulk Entry / 批量录入
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>批量录入维保设备</DialogTitle>
          <DialogDescription>
            从 Excel
            复制七列：Model、CT、SPMS、QTY、Duration（年）、Remark、Description。可含表头，空白数值按
            0；CT、SPMS 自动向上取整至两位小数。U/P、Yearly 和 Total 自动计算。
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="Maintenance bulk rows"
          value={text}
          maxLength={1000000}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
          className="h-48 w-full resize-y rounded border bg-background p-2 font-mono text-xs"
          placeholder={
            'Model\tCT\tSPMS\tQTY\tDuration\tRemark\tDescription\nRouter A\t100\t50\t2\t3\t'
          }
        />
        {preview?.errors.length ? (
          <p role="alert" className="text-sm text-destructive">
            {preview.errors.join('\n')}
          </p>
        ) : null}
        {preview && !preview.errors.length ? (
          <div className="max-h-40 overflow-auto text-xs">
            {preview.rows.map((row, index) => (
              <p key={row.id}>
                {index + 1}. {row.model || '—'} · CT {row.ct?.toFixed(2)} + SPMS{' '}
                {row.spms?.toFixed(2)} · {row.quantity} × {row.durationYears}{' '}
                years
              </p>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => setPreview(parseMaintenanceBulk(text))}
          >
            Preview
          </Button>
          <Button
            disabled={
              disabled || !preview?.rows.length || !!preview.errors.length
            }
            onClick={() => {
              if (preview?.rows.length && onImport(preview.rows))
                setOpen(false);
            }}
          >
            Import rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
