'use client';
import { formatMoney } from '@/lib/money';
/** Preview and atomically update clipboard rows using the same annual-price rules as the grid. */
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
import { parseMaintenanceBulk, maintenanceBulkText } from './bulk-entry';
import type { BoqLine } from './domain';

export function MaintenanceBulkDialog({
  disabled,
  rows,
  onImport,
}: {
  disabled: boolean;
  rows: BoqLine[];
  onImport: (rows: BoqLine[], expected: string) => boolean;
}) {
  const [expected, setExpected] = useState('');
  const [error, setError] = useState('');
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
          setText(maintenanceBulkText(rows));
          setExpected(JSON.stringify(rows));
          setError('');
          setPreview(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        Bulk Entry / 批量录入
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>批量更新维保设备</DialogTitle>
          <DialogDescription>
            当前设备已载入，可直接修改。保留末列 Row ID 更新原行；清空 ID
            添加新行。 七列 Excel 粘贴按唯一 Model
            匹配更新。未列出的设备保留。CT、SPMS
            自动向上取整至两位小数，合计自动计算。
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {preview?.errors.length ? (
          <p role="alert" className="text-sm text-destructive">
            {preview.errors.join('\n')}
          </p>
        ) : null}
        {preview && !preview.errors.length ? (
          <div className="max-h-40 overflow-auto text-xs">
            {preview.rows.map((row, index) => (
              <p key={row.id}>
                {index + 1}. {row.model || '—'} · CT {formatMoney(row.ct)} +
                SPMS {formatMoney(row.spms)} · {row.quantity} ×{' '}
                {row.durationYears} years
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
            onClick={() => {
              setError('');
              if (expected !== JSON.stringify(rows)) {
                setPreview(null);
                setError('设备数据已变化，请关闭后重新打开，载入最新数据。');
              } else setPreview(parseMaintenanceBulk(text, rows));
            }}
          >
            Preview
          </Button>
          <Button
            disabled={
              disabled || !preview?.rows.length || !!preview.errors.length
            }
            onClick={() => {
              if (expected !== JSON.stringify(rows)) {
                setPreview(null);
                setError('设备数据已变化，请关闭后重新打开，载入最新数据。');
                return;
              }
              if (preview?.rows.length && onImport(preview.rows, expected))
                setOpen(false);
              else setError('未应用更新，请检查当前项目状态后重试。');
            }}
          >
            Apply changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
