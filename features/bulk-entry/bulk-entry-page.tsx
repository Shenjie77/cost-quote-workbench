'use client';

import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
import { CheckInput } from '@/components/ui/check-input';
import type { ICellData } from '@univerjs/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, Check, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CalculationCommands } from '@/features/calculation/calculation-editor';
const CalculationEditor = lazy(() =>
  import('@/features/calculation/calculation-editor').then((module) => ({
    default: module.CalculationEditor,
  })),
);
import type { CalculationDocument } from '@/features/calculation/workbook';
import { entryHeader, entrySample } from './column-guide';
import {
  upgradeEntryHeaders,
  entryWorkbook,
  type EntrySheet,
  type EntryIssue,
} from './workbook';
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
  const [initial, setInitial] = useState(() => entryWorkbook(sheets));
  const [loadedContext, setLoadedContext] = useState(contextKey);
  const [selected, setSelected] = useState([initialSheet ?? sheets[0].id]);
  const [review, setReview] = useState<{
    preview: EntryPreview<T>;
    content: string;
    context: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState('');
  const [generation, setGeneration] = useState(0);
  const commands = useRef<CalculationCommands | null>(null),
    errors = useRef<HTMLDivElement | null>(null),
    inFlight = useRef(false);
  const latest = useRef({ contextKey, disabled, onPreview, onImport, onClose });
  useEffect(() => {
    latest.current = { contextKey, disabled, onPreview, onImport, onClose };
  }, [contextKey, disabled, onPreview, onImport, onClose]);
  const validate = async () => {
    if (inFlight.current || latest.current.disabled) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const doc = await commands.current!.read();
      if (loadedContext !== latest.current.contextKey)
        throw new Error(
          'Current data changed while this window was open. Reload current data before editing.',
        );
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
    try {
      const doc = await commands.current!.read();
      const content = contentKey(doc, selected);
      if (
        content !== review.content ||
        latest.current.contextKey !== review.context
      )
        throw new Error(
          'Data or destination changed after validation. Validate again before applying changes.',
        );
      if (review.preview.issues.length || !review.preview.count)
        throw new Error('Resolve validation errors before applying changes.');
      if (!(await latest.current.onImport(review.preview.payload)))
        throw new Error(
          'Changes were not applied. The destination may have changed or become locked.',
        );
      latest.current.onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setReview(null);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  };
  const reloadCurrent = async () => {
    if (
      inFlight.current ||
      !ready ||
      !window.confirm(
        'Discard edits in this window and reload the current saved data?',
      )
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      await commands.current!.read();
      setInitial(entryWorkbook(sheets));
      setLoadedContext(latest.current.contextKey);
      setReady(false);
      setReview(null);
      setGeneration((current) => current + 1);
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
      if (ready) {
        const document = await commands.current!.read();
        const ids = sheets.map((sheet) => sheet.id);
        if (
          contentKey(document, ids) !== contentKey(initial, ids) &&
          !window.confirm(
            'Leave without applying these edits? Current saved data will be kept.',
          )
        )
          return;
      }
      latest.current.onClose();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContent
        variant="workspace"
        size="full"
        showCloseButton={false}
        aria-label="Bulk Entry"
        className="calculation-page-editor"
      >
        <Surface
          as="header"
          variant="header"
          className="flex shrink-0 flex-wrap items-center"
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void close()}
          >
            <ArrowLeft aria-hidden="true" /> Back
          </Button>
          <DialogTitle>Bulk Entry</DialogTitle>
          <Text
            as="span"
            tone="muted"
            textRole="body-small"
            className="min-w-0 break-words"
          >
            {target}
          </Text>
          <Text
            as="span"
            tone="muted"
            textRole="body-small"
            className="ml-auto"
          >
            Edit current rows · Blank Row ID adds a row · Unlisted rows are kept
            {sheets.some((s) => s.columns.some((c) => c.requiredTogether))
              ? ' · Code or Description: fill either'
              : ''}
          </Text>
        </Surface>
        <Surface
          as="div"
          variant="item"
          textRole="body-small"
          className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2"
          aria-label="Sheets to update"
        >
          <span>{singleSheet ? 'Update sheet:' : 'Update sheets:'}</span>
          {sheets.map((sheet) => (
            <label key={sheet.id} className="flex items-center gap-2">
              <CheckInput
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
          <Disclosure className="ml-auto">
            <DisclosureSummary className="cursor-pointer">
              Column guide
            </DisclosureSummary>
            <Surface
              as="div"
              variant="inset"
              className="absolute right-3 z-50 mt-2 max-h-64 max-w-md overflow-auto"
            >
              {sheets
                .filter((s) => selected.includes(s.id))
                .map((s) => (
                  <div key={s.id}>
                    <strong>{s.name}</strong>
                    {s.columns.map((c) => (
                      <Surface key={c.key} as="p" variant="body">
                        <b>{c.label}</b>
                        {c.required || c.requiredForNew ? ' *' : ''} —{' '}
                        {entryHeader(c).split('\n')[1]} · Sample:{' '}
                        {entrySample(c)}
                        {c.options?.length ? ` (${c.options.join(', ')})` : ''}
                      </Surface>
                    ))}
                  </div>
                ))}
            </Surface>
          </Disclosure>
        </Surface>
        {message && (
          <Surface
            role="alert"
            as="p"
            variant="item"
            tone="danger"
            textRole="body-small"
          >
            {message}
          </Surface>
        )}
        {review && (
          <Surface
            ref={errors}
            tabIndex={-1}
            role={review.preview.issues.length ? 'alert' : 'status'}
            as="div"
            variant="item"
            textRole="body-small"
            className="max-h-36 shrink-0 overflow-auto"
          >
            <p>
              {review.preview.summary}
              {review.preview.issues.length
                ? ` · ${review.preview.issues.length} ${review.preview.issues.length === 1 ? 'error' : 'errors'}`
                : ''}
            </p>
            {review.preview.issues.slice(0, 100).map((issue, i) => (
              <Button
                variant="ghost"
                key={i}
                className="block text-left underline underline-offset-2"
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
              </Button>
            ))}
          </Surface>
        )}
        <div className="min-h-0 flex-1">
          <Suspense
            fallback={
              <Surface as="p" variant="body" textRole="body-main">
                Loading spreadsheet…
              </Surface>
            }
          >
            <CalculationEditor
              key={`${draftId}:${generation}`}
              draftId={draftId}
              persistDraft={false}
              initialDocument={initial}
              prepareDocument={(document) =>
                upgradeEntryHeaders(document, sheets)
              }
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
                    onClick={() => void reloadCurrent()}
                  >
                    <RotateCcw aria-hidden="true" /> Reload current data
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
                    {busy ? 'Working…' : 'Apply changes'}
                  </Button>
                </>
              }
            />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
