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
    <div className="flex min-w-96 items-center gap-1">
      <Input
        className="h-8 min-w-0 flex-1 rounded-none border-transparent bg-transparent px-2 text-xs shadow-none md:text-xs"
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
          ...new Set(['Mandatory', 'Optional', ...sections.filter(Boolean)]),
        ].map((title) => (
          <option key={title} value={title}>
            {title}
          </option>
        ))}
      </datalist>
      <Input
        className="h-8 min-w-0 flex-1 rounded-none border-transparent bg-transparent px-2 text-xs shadow-none md:text-xs"
        aria-label={`${label} category`}
        list={id}
        maxLength={120}
        placeholder="Category title"
        value={value.category}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
      />
      <datalist id={id}>
        {[
          ...new Set(['Professional Service', 'Maintenance', ...categories]),
        ].map((title) => (
          <option key={title} value={title}>
            {title}
          </option>
        ))}
      </datalist>
      <select
        aria-label={`${label} inclusion`}
        className="h-8 shrink-0 rounded-none border border-transparent bg-transparent px-2 text-xs shadow-none outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        value={value.inclusion}
        disabled={disabled}
        onChange={(e) =>
          onChange({
            ...value,
            inclusion: e.target.value as QuoteLineGroup['inclusion'],
            section:
              !value.section ||
              ['Mandatory', 'Optional'].includes(value.section)
                ? e.target.value === 'mandatory'
                  ? 'Mandatory'
                  : 'Optional'
                : value.section,
          })
        }
      >
        <option value="mandatory">Mandatory</option>
        <option value="optional">Optional</option>
      </select>
    </div>
  );
}
