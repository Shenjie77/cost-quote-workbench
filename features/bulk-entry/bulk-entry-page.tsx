'use client';
import type { ICellData } from '@univerjs/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CalculationCommands } from '@/features/calculation/calculation-editor';
const CalculationEditor = lazy(() =>
  import('@/features/calculation/calculation-editor').then((module) => ({
    default: module.CalculationEditor,
  })),
);
import type { CalculationDocument } from '@/features/calculation/workbook';
import { entryWorkbook, type EntrySheet, type EntryIssue } from './workbook';
export type EntryPreview<T> = {
  payload: T;
  issues: EntryIssue[];
  summary: string;
  count: number;
};
const contentKey = (document: CalculationDocument, ids: string[]) =>
  JSON.stringify(
    ids.map((id) => [
      id,
      Object.entries(
        (document.workbook.sheets?.[id]?.cellData ?? {}) as Record<
          number,
          Record<number, ICellData>
        >,
      )
        .map(([r, cells]) => [
          r,
          Object.entries(cells)
            .filter(
              ([, cell]) =>
                cell?.f ||
                (cell?.v !== undefined && cell.v !== null && cell.v !== ''),
            )
            .map(([c, cell]) => [c, cell.v, cell.f]),
        ])
        .filter(([, cells]) => (cells as unknown[]).length),
    ]),
  );
export function BulkEntryPage<T>({
  draftId,
  target,
  sheets,
  initialSheet,
  contextKey,
  disabled = false,
  singleSheet = false,
  onPreview,
  onImport,
  onClose,
}: {
  draftId: string;
  target: string;
  sheets: EntrySheet[];
  initialSheet?: string;
  contextKey: string;
  disabled?: boolean;
  singleSheet?: boolean;
  onPreview: (
    document: CalculationDocument,
    selected: string[],
  ) => EntryPreview<T> | Promise<EntryPreview<T>>;
  onImport: (payload: T) => boolean | Promise<boolean>;
  onClose: () => void;
}) {
  const [initial] = useState(() => entryWorkbook(sheets));
  const [selected, setSelected] = useState([initialSheet ?? sheets[0].id]);
  const [review, setReview] = useState<{
    preview: EntryPreview<T>;
    content: string;
    context: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState('');
  const [batch, setBatch] = useState(() => {
    try {
      return Number(localStorage.getItem('bulk-current-batch:' + draftId)) || 0;
    } catch {
      return 0;
    }
  });
  const commands = useRef<CalculationCommands | null>(null),
    root = useRef<HTMLElement | null>(null),
    errors = useRef<HTMLDivElement | null>(null),
    inFlight = useRef(false);
  const latest = useRef({ contextKey, disabled, onPreview, onImport, onClose });
  useEffect(() => {
    latest.current = { contextKey, disabled, onPreview, onImport, onClose };
  }, [contextKey, disabled, onPreview, onImport, onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const siblings = [...document.body.children].filter(
      (el) => el !== root.current,
    );
    const previousInert = siblings.map((el) => el.hasAttribute('inert'));
    siblings.forEach((el) => el.setAttribute('inert', ''));
    root.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      siblings.forEach((el, i) => {
        if (!previousInert[i]) el.removeAttribute('inert');
      });
      previous?.focus();
    };
  }, []);
  const validate = async () => {
    if (inFlight.current || latest.current.disabled) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const doc = await commands.current!.read();
      const context = latest.current.contextKey;
      const preview = await latest.current.onPreview(doc, selected);
      if (context !== latest.current.contextKey)
        throw new Error('The destination changed. Validate again.');
      setReview({ preview, content: contentKey(doc, selected), context });
      if (preview.issues.length)
        requestAnimationFrame(() => errors.current?.focus());
    } catch (error) {
      setReview(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const commit = async () => {
    if (inFlight.current || latest.current.disabled || !review) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const receipts: string[] = [];
    try {
      const doc = await commands.current!.read();
      const content = contentKey(doc, selected);
      if (
        content !== review.content ||
        latest.current.contextKey !== review.context
      )
        throw new Error(
          'Data or destination changed after validation. Validate again before importing.',
        );
      if (review.preview.issues.length || !review.preview.count)
        throw new Error('Resolve validation errors before importing.');
      const receiptKeys = selected.map(
        (id) => `cost-workbench.bulk-import.${draftId}:${batch}:${id}`,
      );
      if (receiptKeys.some((key) => localStorage.getItem(key)))
        throw new Error(
          'A selected sheet in this batch was already imported. Start a new batch before adding more rows.',
        );
      for (const key of receiptKeys) {
        localStorage.setItem(key, 'imported');
        receipts.push(key);
      }
      if (!(await latest.current.onImport(review.preview.payload)))
        throw new Error(
          'Import was not applied. The destination may have changed or become locked.',
        );
      receipts.length = 0;
      latest.current.onClose();
    } catch (error) {
      for (const key of receipts) localStorage.removeItem(key);
      setMessage(error instanceof Error ? error.message : String(error));
      setReview(null);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const startBatch = async () => {
    if (
      inFlight.current ||
      !ready ||
      !window.confirm('Start a blank batch? The previous draft remains saved.')
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await commands.current!.read();
      const next = Date.now();
      localStorage.setItem('bulk-current-batch:' + draftId, String(next));
      setReady(false);
      setReview(null);
      setBatch(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const close = async () => {
    if (inFlight.current) return;
    setBusy(true);
    try {
      if (ready) await commands.current!.read();
      latest.current.onClose();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return typeof document === 'undefined'
    ? null
    : createPortal(
        <section
          ref={root}
          tabIndex={-1}
          aria-label="Bulk Entry"
          className="calculation-page-editor fixed inset-0 z-[90] flex min-w-0 flex-col bg-background outline-none"
        >
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void close()}
            >
              <ArrowLeft aria-hidden="true" /> Back
            </Button>
            <h1 className="text-sm font-semibold">Bulk Entry</h1>
            <span className="min-w-0 break-words text-xs text-muted-foreground">
              {target}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              Fixed headers · Paste values below row 1
            </span>
          </header>
          <div
            className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/30 px-3 py-2 text-xs"
            aria-label="Sheets to import"
          >
            <span className="font-medium">
              {singleSheet ? 'Import sheet:' : 'Import sheets:'}
            </span>
            {sheets.map((sheet) => (
              <label key={sheet.id} className="flex items-center gap-1.5">
                <input
                  type={singleSheet ? 'radio' : 'checkbox'}
                  name="bulk-import-sheet"
                  checked={selected.includes(sheet.id)}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(
                      singleSheet
                        ? [sheet.id]
                        : e.target.checked
                          ? [...selected, sheet.id]
                          : selected.filter((id) => id !== sheet.id),
                    );
                    setReview(null);
                    commands.current?.focusCell(sheet.id, 2, 1);
                  }}
                />
                {sheet.name}
              </label>
            ))}
            <details className="ml-auto">
              <summary className="cursor-pointer">Column guide</summary>
              <div className="absolute right-3 z-50 mt-2 max-h-64 max-w-md overflow-auto border bg-background p-3 shadow-sm">
                {sheets
                  .filter((s) => selected.includes(s.id))
                  .map((s) => (
                    <div key={s.id}>
                      <strong>{s.name}</strong>
                      {s.columns.map((c) => (
                        <p key={c.key} className="py-1">
                          <b>{c.label}</b>
                          {c.required ? ' *' : ''} —{' '}
                          {c.description || c.kind || 'Text'}
                          {c.options?.length
                            ? ` (${c.options.join(', ')})`
                            : ''}
                        </p>
                      ))}
                    </div>
                  ))}
              </div>
            </details>
          </div>
          {message && (
            <p
              role="alert"
              className="border-b px-3 py-2 text-xs text-destructive"
            >
              {message}
            </p>
          )}
          {review && (
            <div
              ref={errors}
              tabIndex={-1}
              role={review.preview.issues.length ? 'alert' : 'status'}
              className="max-h-36 shrink-0 overflow-auto border-b px-3 py-2 text-xs outline-none"
            >
              <p className="font-medium">
                {review.preview.summary}
                {review.preview.issues.length
                  ? ` · ${review.preview.issues.length} ${review.preview.issues.length === 1 ? 'error' : 'errors'}`
                  : ''}
              </p>
              {review.preview.issues.slice(0, 100).map((issue, i) => (
                <button
                  key={i}
                  className="block py-1 text-left text-destructive underline underline-offset-2 focus-visible:outline"
                  onClick={() =>
                    commands.current?.focusCell(
                      issue.sheet,
                      issue.row,
                      issue.column ?? 1,
                    )
                  }
                >
                  {sheets.find((s) => s.id === issue.sheet)?.name} ·{' '}
                  {issue.column
                    ? `${String.fromCharCode(64 + issue.column)}${issue.row}`
                    : `Row ${issue.row}`}
                  : {issue.message}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={<p className="p-3 text-sm">Loading spreadsheet…</p>}
            >
              <CalculationEditor
                key={`${draftId}:${batch}`}
                draftId={batch ? `${draftId}:batch:${batch}` : draftId}
                initialDocument={initial}
                title="Bulk Entry workbook"
                pageLayout
                readOnly={disabled || busy}
                commandsRef={commands}
                fixedHeaders={sheets.map((s) => s.id)}
                initialSheet={initialSheet ?? sheets[0].id}
                onReady={() => setReady(true)}
                headerActions={
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!ready || busy}
                      onClick={() => void startBatch()}
                    >
                      <RotateCcw aria-hidden="true" /> New batch
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!ready || busy || disabled || !selected.length}
                      onClick={() => void validate()}
                    >
                      <Check aria-hidden="true" /> Validate
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !ready ||
                        busy ||
                        disabled ||
                        !review ||
                        !!review.preview.issues.length ||
                        !review.preview.count
                      }
                      onClick={() => void commit()}
                    >
                      <Upload aria-hidden="true" />{' '}
                      {busy ? 'Working…' : 'Import'}
                    </Button>
                  </>
                }
              />
            </Suspense>
          </div>
        </section>,
        document.body,
      );
}
