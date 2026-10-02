import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  loadSavedQuoteLayouts,
  saveQuoteLayout,
} from '@/features/quote/excel-template-client';
import {
  reusableLayout,
  type SavedQuoteLayout,
} from '@/features/quote/layout-presets';
import type { QuoteExcelTemplate } from '@/features/quote/excel-template-types';

/** Saved presets are independent of the selected customer's immutable workbook asset. */
export function QuoteLayoutLibrary({
  mapping,
  disabled,
  validate,
  onApply,
}: {
  mapping: QuoteExcelTemplate;
  disabled: boolean;
  validate: () => Promise<void>;
  onApply: (layout: SavedQuoteLayout['mapping']) => void;
}) {
  const [layouts, setLayouts] = useState<SavedQuoteLayout[]>([]),
    [selected, setSelected] = useState(''),
    [name, setName] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const alive = useRef(true),
    inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    void loadSavedQuoteLayouts()
      .then((rows) => {
        if (alive.current) setLayouts(rows);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const choice = layouts.find((layout) => layout.id === selected);
  async function save(update: boolean) {
    if (inFlight.current || disabled || !name.trim() || (update && !choice))
      return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const snapshot = structuredClone(mapping),
      selectedSnapshot = choice,
      savedName = name.trim();
    try {
      await validate();
      if (!alive.current) return;
      const saved = await saveQuoteLayout({
        name: savedName,
        mapping: reusableLayout(snapshot),
        ...(update
          ? {
              id: selectedSnapshot!.id,
              expectedRevision: selectedSnapshot!.revision,
            }
          : {}),
      });
      if (!alive.current) return;
      setLayouts((rows) =>
        [...rows.filter((row) => row.id !== saved.id), saved].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      setSelected(saved.id);
      setName(saved.name);
      setMessage(
        `Layout “${saved.name}” saved. It can be reused with another workbook or logo.`,
      );
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Cannot save layout.');
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const control =
    'h-8 min-w-0 rounded border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring';
  return (
    <fieldset
      disabled={disabled || busy}
      className="space-y-2 border-b pb-3"
      aria-label="Saved structured layouts"
    >
      <legend className="mb-2 text-xs font-medium">
        Saved structured layouts
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-52 flex-1 items-center gap-2 text-xs">
          Layout
          <select
            aria-label="Saved layout"
            className={`${control} flex-1`}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const item = layouts.find((row) => row.id === e.target.value);
              if (item) setName(item.name);
            }}
          >
            <option value="">Select a saved layout</option>
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!choice}
          onClick={() => {
            onApply(choice!.mapping);
            setMessage(
              'Layout loaded into this draft. Apply mapping and save the template to use it.',
            );
            setError('');
          }}
        >
          Load layout
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            setError('');
            try {
              const rows = await loadSavedQuoteLayouts();
              if (alive.current) setLayouts(rows);
            } catch (e) {
              if (alive.current)
                setError(
                  e instanceof Error ? e.message : 'Cannot reload layouts.',
                );
            }
          }}
        >
          Reload layouts
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-52 flex-1 items-center gap-2 text-xs">
          Name
          <input
            aria-label="Layout name"
            className={`${control} flex-1`}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!mapping.body || !name.trim()}
          onClick={() => void save(false)}
        >
          Save as new layout
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!choice || !mapping.body || !name.trim()}
          onClick={() => void save(true)}
        >
          Update layout
        </Button>
      </div>
      {busy && (
        <output className="block text-xs text-muted-foreground">
          Validating and saving layout…
        </output>
      )}
      {message && (
        <output className="block text-xs text-muted-foreground">
          {message}
        </output>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
