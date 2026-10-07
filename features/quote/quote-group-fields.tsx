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
    <div className="flex min-w-64 items-center gap-1">
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
    </div>
  );
}
