import { DisclosureSummary } from '@/components/ui/presentation';
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import type { QuoteLineGroup } from './quotation-groups';
export function QuoteGroupFields({
  value,
  onChange,
  label,
  disabled,
  categories = [],
  sections = [],
}: {
  value: QuoteLineGroup;
  onChange: (value: QuoteLineGroup) => void;
  label: string;
  disabled?: boolean;
  categories?: string[];
  sections?: string[];
}) {
  const id = useId();
  return (
    <div className="grid min-w-48 gap-1">
      <Input
        variant="grid"
        className="min-w-0 flex-1"
        aria-label={`${label} category`}
        list={id}
        maxLength={120}
        placeholder="Category / 成本分类"
        value={value.category}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
      />
      <datalist id={id}>
        {[...new Set([value.category, ...categories].filter(Boolean))].map(
          (title) => (
            <option key={title} value={title}>
              {title}
            </option>
          ),
        )}
      </datalist>
      <details>
        <DisclosureSummary>Section / 报价章节（可选）</DisclosureSummary>
        <Input
          variant="grid"
          className="min-w-0 flex-1"
          aria-label={`${label} section`}
          list={`${id}-sections`}
          maxLength={120}
          placeholder="Section title"
          value={
            value.section ??
            (value.inclusion === 'mandatory' ? 'Mandatory' : 'Optional')
          }
          disabled={disabled}
          onChange={(e) => onChange({ ...value, section: e.target.value })}
        />
        <datalist id={`${id}-sections`}>
          {[
            ...new Set([
              value.section || 'Mandatory',
              ...sections.filter(Boolean),
            ]),
          ].map((title) => (
            <option key={title} value={title}>
              {title}
            </option>
          ))}
        </datalist>
      </details>
    </div>
  );
}
