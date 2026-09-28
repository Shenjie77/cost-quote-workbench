'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { roundMoney } from '../cost/domain';
/** Keep decimal typing local and commit one upward-rounded price when editing ends. */
export function MaintenancePriceInput({
  value,
  label,
  onChange,
}: {
  value: number | undefined;
  label: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value?.toFixed(2) ?? ''),
    [invalid, setInvalid] = useState(false);
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid}
      type="text"
      inputMode="decimal"
      className="h-8 min-w-20 text-right text-xs"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        if (draft === (value?.toFixed(2) ?? '')) return;
        const amount = Number(draft);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) {
          setInvalid(true);
          return;
        }
        const rounded = roundMoney(amount);
        setDraft(rounded.toFixed(2));
        if (rounded !== value) onChange(rounded);
      }}
    />
  );
}
