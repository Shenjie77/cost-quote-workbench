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
    label: `${item.name} · ${item.clientPattern.trim() === '*' ? 'Common / 通用' : item.clientPattern}`,
  }));

  return (
    <section
      aria-labelledby="quote-template-heading"
      className="min-w-0 border border-border border-l-4 border-l-[#173a52] bg-card p-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="quote-template-heading" className="text-sm font-semibold">
          Quotation Template{' '}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            引用报价模板
          </span>
        </h2>
        <span className="text-xs text-muted-foreground">
          Client / 客户：{client} · {choices.length} available / 个适用模板
        </span>
      </div>
      <div className="grid items-end gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0">
          <label
            id="quote-template-label"
            htmlFor="quote-template-select"
            className="mb-1 block text-xs text-muted-foreground"
          >
            Select template / 选择模板
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
              <SelectValue>
                {candidate?.name || 'Select template / 选择模板'}
              </SelectValue>
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
          <FileCheck2 /> Apply Template{' '}
          <span className="text-xs opacity-75">引用模板</span>
        </Button>
        <Button variant="outline" onClick={onManage}>
          Manage templates <span className="text-xs opacity-65">管理模板</span>
        </Button>
      </div>
      <div
        className="mt-2 space-y-1 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <p>
          Applied / 当前已引用：
          <span className="font-medium text-foreground">
            {selected?.name || 'None / 未引用'}
          </span>
          {!selectedAvailable && (
            <span className="ml-2 text-amber-700">
              Unavailable / 请重新选择适用模板
            </span>
          )}
        </p>
        {candidate && candidate.id !== selectedId && (
          <p className="text-amber-700">
            Selection not applied yet — click Apply Template. /
            尚未引用，请点击“引用模板”。
          </p>
        )}
        {choices.length ? (
          <p>
            Apply title, payment terms and T&C; append eligible default
            assumptions without overwriting quote edits. / 引用标题、付款条款及
            T&C，补入默认假设，保留本次已编辑内容。
          </p>
        ) : (
          <p role="alert" className="text-amber-700">
            No active template matches this client. Manage templates to add one
            or copy from another project. /
            无适用模板，请进入管理模板新增或从其他项目复制；客户名称需匹配，*
            为通用。
          </p>
        )}
      </div>
    </section>
  );
}
