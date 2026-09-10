/** Visible quotation entry point: choosing is local; Apply explicitly uses the template. */
import { useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { applicableTemplates } from './catalog-domain';
import type { QuoteTemplate } from './types';

/** No catalogue edits or writes occur here. The parent applies and persists the choice. */
export function QuoteTemplatePicker({
  templates,
  client,
  selectedId,
  onApply,
  onManage,
  busy,
}: {
  templates: QuoteTemplate[];
  client: string;
  selectedId: string;
  onApply: (id: string) => void;
  onManage: () => void;
  busy: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const choices = applicableTemplates(templates, client);
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
    <section
      aria-labelledby="quote-template-heading"
      className="wb-panel min-w-0 border-l-4 border-l-primary p-4"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="quote-template-heading" className="text-sm font-semibold">
          Quotation Template
        </h2>
        <span className="text-xs text-muted-foreground">
          Client: {client} · {choices.length} available
        </span>
      </div>
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0">
          <label
            id="quote-template-label"
            htmlFor="quote-template-select"
            className="mb-1 block text-xs text-muted-foreground"
          >
            Select template
          </label>
          <Select
            items={items}
            value={candidate?.id ?? null}
            onValueChange={(value) => setPendingId(value)}
            disabled={!choices.length || busy}
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
          disabled={!candidate || busy}
          onClick={() => candidate && onApply(candidate.id)}
        >
          <FileCheck2 /> Apply Template
        </Button>
        <Button variant="outline" onClick={onManage}>
          Manage templates
        </Button>
      </div>
      <div
        className="mt-2 space-y-1 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <p>
          Applied:{' '}
          <span className="font-medium text-foreground">
            {selected?.name || 'None'}
          </span>
          {!selectedAvailable && (
            <span className="ml-2 text-amber-700">
              Unavailable — select an applicable template
            </span>
          )}
        </p>
        {candidate && candidate.id !== selectedId && (
          <p className="text-amber-700">
            Selection not applied yet — click Apply Template.
          </p>
        )}
        {choices.length ? (
          <p>
            Apply title, payment terms and T&C; append eligible default
            assumptions without overwriting quote edits.
          </p>
        ) : (
          <p role="alert" className="text-amber-700">
            No active template matches this client. Manage templates to add one
            or copy from another project.
          </p>
        )}
      </div>
    </section>
  );
}
