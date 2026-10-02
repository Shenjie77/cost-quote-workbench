'use client';
import {
  type ReactNode,
  type RefObject,
  useImperativeHandle,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { CalculationDocument } from './workbook';
import { loadCalculation, saveCalculation } from './workbook';
import type { UniverHandle } from './univer-runtime';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';

export type CalculationCommands = {
  read: () => Promise<CalculationDocument>;
  focusCell: (sheet: string, row?: number, column?: number) => void;
};

/** A durable draft, separate from approved cost data. Recovery survives a failed API save. */
export function CalculationEditor({
  draftId,
  initialDocument,
  readOnly = false,
  onApply,
  onDirtyChange,
  onClose,
  headerActions,
  titleActions,
  title = 'Calculation draft',
  pageLayout = false,
  backToWorkbench = false,
  commandsRef,
  fixedHeaders,
  initialSheet,
  onReady,
}: {
  draftId: string;
  initialDocument: CalculationDocument;
  commandsRef?: RefObject<CalculationCommands | null>;
  fixedHeaders?: string[];
  initialSheet?: string;
  onReady?: () => void;
  readOnly?: boolean;
  title?: string;
  pageLayout?: boolean;
  backToWorkbench?: boolean;
  onApply?: (document: CalculationDocument) => string | Promise<string>;
  onDirtyChange?: (dirty: boolean) => void;
  onClose?: () => void;
  headerActions?: ReactNode;
  titleActions?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<UniverHandle | null>(null);
  const initial = useRef(initialDocument);
  const latest = useRef<CalculationDocument>(initialDocument);
  const revision = useRef<number | null>(null);
  const savedJson = useRef('');
  const pending = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const failure = useRef(false);
  const disposed = useRef(false);
  const applying = useRef(false);
  const loaded = useRef(false);
  const suppressCapture = useRef(false);
  const callbacks = useRef({
    onApply,
    onDirtyChange,
    readOnly,
    fixedHeaders,
    initialSheet,
    onReady,
  });
  useEffect(() => {
    callbacks.current = {
      onApply,
      onDirtyChange,
      readOnly,
      fixedHeaders,
      initialSheet,
      onReady,
    };
  }, [onApply, onDirtyChange, readOnly, fixedHeaders, initialSheet, onReady]);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState('Loading draft…');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const recoveryKey = `cost-workbench.calculation-recovery.${draftId}`;

  const keepRecovery = useCallback(
    (document: CalculationDocument) => {
      try {
        localStorage.setItem(
          recoveryKey,
          JSON.stringify({ document, revision: revision.current }),
        );
      } catch {
        /* The database save remains available when browser storage is full. */
      }
    },
    [recoveryKey],
  );
  const persist = useCallback(
    (document: CalculationDocument, retry = false) => {
      if (failure.current && !retry) return pending.current;
      const captured = structuredClone(document);
      const json = JSON.stringify(captured);
      pending.current = pending.current.then(async () => {
        if (json === savedJson.current || (failure.current && !retry)) return;
        if (!disposed.current) setStatus('Saving…');
        try {
          const record = await saveCalculation(
            draftId,
            captured,
            revision.current,
          );
          revision.current = record.revision;
          savedJson.current = json;
          failure.current = false;
          if (JSON.stringify(latest.current) === json) {
            try {
              localStorage.removeItem(recoveryKey);
            } catch {
              /* Optional recovery cache. */
            }
            if (!disposed.current) setStatus('Saved locally');
          } else keepRecovery(latest.current);
          if (!disposed.current) setError('');
        } catch (cause) {
          failure.current = true;
          keepRecovery(latest.current);
          if (!disposed.current) {
            setStatus('Not saved');
            setError(
              cause instanceof Error
                ? cause.message
                : 'Unable to save. Download a backup.',
            );
          }
        }
      });
      return pending.current;
    },
    [draftId, recoveryKey, keepRecovery],
  );
  const changed = useCallback(
    (document: CalculationDocument) => {
      if (suppressCapture.current) return;
      latest.current = document;
      if (JSON.stringify(document) === savedJson.current) return;
      keepRecovery(document);
      if (!disposed.current) setStatus('Unsaved changes');
      callbacks.current.onDirtyChange?.(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void persist(document);
      }, 650);
    },
    [keepRecovery, persist],
  );

  useEffect(() => {
    let cancelled = false;
    disposed.current = false;
    loaded.current = false;
    suppressCapture.current = false;
    failure.current = false;
    void (async () => {
      try {
        const record = await loadCalculation(draftId);
        if (cancelled) return;
        revision.current = record?.revision ?? null;
        let document = record?.document ?? initial.current;
        savedJson.current = record ? JSON.stringify(document) : '';
        try {
          const raw = localStorage.getItem(recoveryKey);
          const recovery = raw ? JSON.parse(raw) : null;
          if (recovery?.document?.workbook) {
            document = recovery.document;
            if (recovery.revision !== revision.current) {
              revision.current = recovery.revision ?? null;
              failure.current = true;
              setError(
                'A recovered draft conflicts with the database copy. Download a backup, then reload the saved copy.',
              );
            }
          }
        } catch {
          /* An unreadable recovery entry must not hide the database copy. */
        }
        latest.current = document;
        const { mountUniver } = await import('./univer-runtime');
        if (cancelled || !container.current) return;
        const handle = mountUniver(
          container.current,
          document.workbook,
          (workbook) => changed({ ...latest.current, workbook }),
          pageLayout ? setToolbarHost : undefined,
        );
        editor.current = handle;
        if (callbacks.current.fixedHeaders)
          await handle.protectHeaders(callbacks.current.fixedHeaders);
        if (cancelled) return;
        if (callbacks.current.initialSheet)
          handle.focusCell(callbacks.current.initialSheet, 2, 1);
        loaded.current = true;
        handle.setReadOnly(callbacks.current.readOnly);
        setReady(true);
        callbacks.current.onReady?.();
        setStatus(
          failure.current
            ? 'Recovery conflict'
            : JSON.stringify(document) !== savedJson.current
              ? 'Recovered / unsaved draft'
              : 'Saved locally',
        );
        if (!failure.current) void persist(document);
      } catch (cause) {
        if (!cancelled) {
          setStatus('Unable to open');
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to open calculation draft.',
          );
        }
      }
    })();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        JSON.stringify(latest.current) !== savedJson.current ||
        failure.current
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      cancelled = true;
      disposed.current = true;
      window.removeEventListener('beforeunload', beforeUnload);
      editor.current?.dispose();
      editor.current = null;
      clearTimeout(timer.current);
      if (loaded.current) void persist(latest.current);
    };
    // Each editor is keyed by its stable draft identity; callbacks use refs.
  }, [draftId, generation, recoveryKey, changed, persist, pageLayout]);

  useEffect(() => {
    editor.current?.setReadOnly(readOnly);
  }, [readOnly, ready]);

  const save = async (apply = false) => {
    if (!editor.current || applying.current) return false;
    applying.current = true;
    setBusy(true);
    setError('');
    try {
      const workbook = await editor.current.calculate();
      clearTimeout(timer.current);
      const document = { ...latest.current, workbook };
      latest.current = document;
      keepRecovery(document);
      await persist(document, true);
      if (failure.current) return false;
      if (apply && callbacks.current.onApply && !callbacks.current.readOnly) {
        const basis = await callbacks.current.onApply(document);
        latest.current = { ...document, basis };
        await persist(latest.current, true);
        callbacks.current.onDirtyChange?.(false);
        if (!failure.current) setStatus('Applied to cost inputs');
      }
      return !failure.current;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to calculate.');
      return false;
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };
  useImperativeHandle(commandsRef, () => ({
    read: async () => {
      if (!editor.current || !ready || applying.current)
        throw new Error('Wait for the workbook to finish loading or saving.');
      if (!(await save()))
        throw new Error('Save the draft successfully before importing.');
      return structuredClone(latest.current);
    },
    focusCell: (sheet, row, column) =>
      editor.current?.focusCell(sheet, row, column),
  }));
  const backup = () => {
    const document = editor.current
      ? { ...latest.current, workbook: editor.current.snapshot() }
      : latest.current;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'calculation-draft.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  const reload = async (fromCosts = false) => {
    if (
      !window.confirm(
        fromCosts
          ? 'Replace this calculation draft with the current cost inputs? Download a backup first if you need these formulas.'
          : 'Discard local recovery and reload the saved calculation draft?',
      )
    )
      return;
    setReady(false);
    setError('');
    clearTimeout(timer.current);
    await pending.current;
    if (fromCosts) {
      try {
        const record = await loadCalculation(draftId);
        const next = await saveCalculation(
          draftId,
          initialDocument,
          record?.revision ?? null,
        );
        latest.current = next.document;
        savedJson.current = JSON.stringify(next.document);
        revision.current = next.revision;
      } catch (cause) {
        setError(String(cause));
        return;
      }
    }
    // Disposal must not write the stale editor back over the chosen replacement.
    failure.current = true;
    suppressCapture.current = true;
    editor.current?.dispose();
    editor.current = null;
    clearTimeout(timer.current);
    try {
      localStorage.removeItem(recoveryKey);
    } catch {
      /* Optional recovery cache. */
    }
    initial.current = initialDocument;
    setGeneration((value) => value + 1);
  };
  const utilityActions = (
    <>
      <Button
        size="sm"
        className={pageLayout ? 'h-7' : undefined}
        variant="ghost"
        onClick={backup}
      >
        Download backup
      </Button>
      {onApply && (
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || busy || readOnly}
          onClick={() => void reload(true)}
        >
          Reload from costs
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className={pageLayout ? 'h-7' : undefined}
        disabled={!ready || busy}
        onClick={() => void save()}
      >
        Save draft
      </Button>
    </>
  );
  const actions = (
    <div
      className="flex items-center gap-2 whitespace-nowrap"
      aria-label="Draft actions"
    >
      {headerActions}
      {pageLayout && (
        <output className="hidden text-xs text-muted-foreground md:block">
          {status}
        </output>
      )}
      {onClose ? (
        <details className="relative">
          <summary className="cursor-pointer rounded border px-2.5 py-1.5 text-xs">
            More
          </summary>
          <div className="absolute right-0 top-full z-50 mt-1 flex min-w-44 flex-col gap-1 rounded-md border bg-white p-2 shadow-md">
            {utilityActions}
          </div>
        </details>
      ) : (
        utilityActions
      )}
      {backToWorkbench && (
        <Link
          href="/"
          className="self-center px-2 text-xs text-primary hover:underline"
        >
          Back to workbench
        </Link>
      )}
      {onClose && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            if (!ready || (await save())) onClose();
          }}
        >
          Done
        </Button>
      )}
      {onApply && (
        <Button
          size="sm"
          disabled={!ready || busy || readOnly}
          onClick={() => void save(true)}
        >
          {busy ? 'Calculating…' : 'Apply to costs'}
        </Button>
      )}
    </div>
  );
  return (
    <section
      className={
        pageLayout
          ? 'calculation-page-editor flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white'
          : 'min-w-0 overflow-hidden rounded-md border border-border bg-white'
      }
      aria-label={title}
    >
      {pageLayout ? (
        <>
          <h1 className="sr-only">{title}</h1>
          {toolbarHost && createPortal(actions, toolbarHost)}
        </>
      ) : (
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5">
          <div className="flex items-center gap-3">
            {pageLayout ? (
              <h1 className="text-sm font-semibold">{title}</h1>
            ) : (
              <h2 className="text-sm font-semibold">{title}</h2>
            )}
            {titleActions}
            <output className="text-xs text-muted-foreground">{status}</output>
          </div>
          {actions}
        </header>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            Reload saved copy
          </Button>
        </div>
      )}
      <div
        ref={container}
        className={
          pageLayout
            ? 'univer-workbench min-h-0 w-full flex-1'
            : 'univer-workbench h-[620px] min-h-[420px] w-full'
        }
      />
    </section>
  );
}
