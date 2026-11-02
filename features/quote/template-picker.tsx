import { Surface, Text } from '@/components/ui/presentation';
/** Visible quotation entry point: choosing is local; Apply explicitly uses the template. */
import { useEffect, useState } from 'react';
import { FileCheck2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { applicableTemplates } from './catalog-domain';
import type { AssumptionDefinition, QuoteTemplate } from './types';
import type { QuoteTemplateCatalog } from './template-catalog';

/** No catalogue edits or writes occur here. The parent applies and persists the choice. */
export function QuoteTemplatePicker({
  templates,
  client,
  selectedId,
  onApply,
  onManage,
  busy,
  loadCatalog,
}: {
  templates: QuoteTemplate[];
  client: string;
  selectedId: string;
  onApply: (
    id: string,
    template?: QuoteTemplate,
    assumptions?: AssumptionDefinition[],
  ) => void;
  loadCatalog?: () => Promise<QuoteTemplateCatalog>;
  onManage: () => void;
  busy: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{
    source: typeof loadCatalog;
    generation: number;
    catalog?: QuoteTemplateCatalog;
    error?: string;
  } | null>(null);
  const loading =
    !!loadCatalog &&
    (loaded?.source !== loadCatalog || loaded?.generation !== refresh);
  const catalog = loaded?.catalog;
  const error = loading ? '' : (loaded?.error ?? '');
  useEffect(() => {
    if (!loadCatalog) return;
    let cancelled = false;
    void loadCatalog()
      .then((result) => {
        if (!cancelled) {
          setLoaded({
            source: loadCatalog,
            generation: refresh,
            catalog: result,
          });
          setPendingId(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setLoaded({
            source: loadCatalog,
            generation: refresh,
            error:
              cause instanceof Error
                ? cause.message
                : 'Unable to load saved templates.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [loadCatalog, refresh]);
  const unavailable = busy || loading || !!error;
  const choices = applicableTemplates(
    loadCatalog ? (catalog?.templates ?? []) : templates,
    client,
  );
  const selected = templates.find((item) => item.id === selectedId);
  const selectedAvailable = choices.some((item) => item.id === selectedId);
  // Prefer the already applied choice. An unavailable selection never silently
  // changes the actual quotation; a suggested replacement still requires Apply.
  const candidate =
    pendingId !== null
      ? choices.find((item) => item.id === pendingId)
      : choices.find((item) => item.id === selectedId) || choices[0];
  const items = choices.map((item) => ({
    value: item.id,
    label: `${item.name} · ${item.clientPattern.trim() === '*' ? 'Common' : item.clientPattern}`,
  }));

  return (
    <Surface
      aria-labelledby="quote-template-heading"
      as="section"
      variant="panel"
      padded
      className="min-w-0"
    >
      {/* Template choice and its actions share one compact toolbar. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="shrink-0">
          <h2 id="quote-template-heading">Quotation Template</h2>
          <span className="sr-only">
            Client: {client} · {choices.length} available
          </span>
        </div>
        <div className="min-w-0 flex-1 basis-64">
          <label
            id="quote-template-label"
            htmlFor="quote-template-select"
            className="sr-only"
          >
            Select template
          </label>
          <Select
            items={items}
            value={candidate?.id ?? null}
            onValueChange={(value) => setPendingId(value)}
            disabled={!choices.length || unavailable}
          >
            <SelectTrigger
              id="quote-template-select"
              aria-labelledby="quote-template-label"
              className="w-full min-w-0"
            >
              <SelectValue>{candidate?.name || 'Select template'}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"

          title="Apply title, payment terms and T&C; append eligible default assumptions without overwriting quote edits."
          disabled={!candidate || unavailable}
          onClick={() =>
            candidate &&
            !unavailable &&
            onApply(candidate.id, candidate, catalog?.assumptions)
          }
        >
          <FileCheck2 /> Apply Template
        </Button>
        {loadCatalog && (
          <Button
            variant="ghost"
            size="sm"

            disabled={busy || loading}
            onClick={() => {
              setRefresh((value) => value + 1);
            }}
          >
            <RefreshCw aria-hidden="true" /> Refresh templates
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onManage}>
          Manage templates
        </Button>
      </div>
      <Surface
        as="div"
        tone="muted"
        textRole="body-small"
        className="mt-1 space-y-1"
        aria-live="polite"
      >
        <p>
          Applied:{' '}
          <Text as="span" tone="default">
            {selected?.name || 'None'}
          </Text>
          {!loading && !error && !selectedAvailable && (
            <Text as="span" tone="warning" className="ml-2">
              Unavailable — select an applicable template
            </Text>
          )}
        </p>
        {candidate && candidate.id !== selectedId && (
          <Text as="p" tone="warning">
            Selection not applied yet — click Apply Template.
          </Text>
        )}
        {loading && <output className="block">Loading saved templates…</output>}
        {error && (
          <Text role="alert" as="p" tone="danger">
            {error} Use Refresh templates to retry. The applied project template
            is unchanged.
          </Text>
        )}
        {!loading &&
          !error &&
          (choices.length ? (
            <p className="sr-only">
              Apply title, payment terms and T&C; append eligible default
              assumptions without overwriting quote edits.
            </p>
          ) : (
            <Text role="alert" as="p" tone="warning">
              No active template matches this client. Manage templates to add
              one with Active enabled and Customer set to this client or *. Save
              the Master Data tab, then refresh templates.
            </Text>
          ))}
      </Surface>
    </Surface>
  );
}
