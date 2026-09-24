/** Full-text viewing and deliberate editing without expanding the quotation grid. */
import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Capture an editable draft on opening; cancelling never changes the saved or inline description. */
export function QuoteDescriptionDialog({
  value,
  lineNumber,
  editable,
  disabled,
  onSave,
}: {
  value: string;
  lineNumber: number;
  editable: boolean;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const changeOpen = (next: boolean) => {
    if (next) setDraft(value);
    setOpen(next);
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" />
        }
        aria-label={`Expand description for line ${lineNumber}`}
        title="Expand description / 展开完整描述"
      >
        <Maximize2 className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Line {lineNumber} description / 完整描述</DialogTitle>
          <DialogDescription>
            The grid shows up to three lines. Full text and line breaks are
            retained in exports. / 表格最多显示三行，导出保留完整内容及换行。
          </DialogDescription>
        </DialogHeader>
        {editable ? (
          <Textarea
            aria-label={`Full description for line ${lineNumber}`}
            value={draft}
            maxLength={4000}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-48 max-h-[55vh] resize-y overflow-y-auto whitespace-pre-wrap"
          />
        ) : (
          <div className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap break-words text-sm">
            {value}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            {editable ? 'Cancel' : 'Close'}
          </Button>
          {editable && (
            <Button
              disabled={disabled}
              onClick={() => {
                if (disabled) return;
                onSave(draft);
                setOpen(false);
              }}
            >
              Save description
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
