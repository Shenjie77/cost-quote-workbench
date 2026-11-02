import { Surface, Text } from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { Input } from '@/components/ui/input';
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
  const control = 'h-8 min-w-0';
  return (
    <Surface
      disabled={disabled || busy}
      as="fieldset"
      variant="item"
      className="space-y-2"
      aria-label="Saved structured layouts"
    >
      <Surface as="legend" textRole="body-small" className="mb-2">
        Saved structured layouts
      </Surface>
      <div className="flex flex-wrap items-center gap-2">
        <Surface
          as="label"
          variant="inline-field"
          textRole="body-small"
          className="flex min-w-52 flex-1 items-center"
        >
          Layout
          <SelectField
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
          </SelectField>
        </Surface>
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
        <Surface
          as="label"
          variant="inline-field"
          textRole="body-small"
          className="flex min-w-52 flex-1 items-center"
        >
          Name
          <Input
            aria-label="Layout name"
            className={`${control} flex-1`}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Surface>
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
        <Text as="output" tone="muted" textRole="body-small" className="block">
          Validating and saving layout…
        </Text>
      )}
      {message && (
        <Text as="output" tone="muted" textRole="body-small" className="block">
          {message}
        </Text>
      )}
      {error && (
        <Text role="alert" as="p" tone="danger" textRole="body-small">
          {error}
        </Text>
      )}
    </Surface>
  );
}
