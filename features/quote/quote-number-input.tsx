/** Keep incomplete numeric typing local until the user commits a valid commercial value. */
import { useState } from 'react';
import { Input } from '@/components/ui/input';

/** Commit on blur or Enter; callers key this control by its saved value to reflect recalculation. */
export function QuoteNumberInput({
  id,
  value,
  label,
  min = 0,
  max = 1e12,
  decimals = 4,
  percentage = false,
  disabled,
  onCommit,
  commitUnchanged = false,
  className = 'h-8 w-full min-w-20 rounded-none border-transparent bg-transparent text-right shadow-none focus-visible:border-ring',
}: {
  id?: string;
  value: number;
  label: string;
  min?: number;
  max?: number;
  decimals?: number;
  /** Percentages are typed manually and displayed with two decimals without rounding saved calculations. */
  percentage?: boolean;
  disabled: boolean;
  onCommit: (value: number) => void;
  /** Explicitly typing an existing percentage/price can still lock that allocation. */
  commitUnchanged?: boolean;
  className?: string;
}) {
  // Seeded ratios retain full precision for allocation while presenting a compact editable number.
  const displayedValue = percentage
    ? value.toFixed(2)
    : String(Number(value.toFixed(decimals)));
  const [draft, setDraft] = useState(String(displayedValue));
  const [invalid, setInvalid] = useState(false);
  const [edited, setEdited] = useState(false);

  /** Reject empty, out-of-range and excess-precision values instead of silently rounding user input. */
  const commit = () => {
    // Calculated GP may legitimately be negative or 100%; validate only an explicitly entered target.
    if (disabled || !edited) return;
    const next = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(next) ||
      next < min ||
      next > max ||
      Number(next.toFixed(decimals)) !== next
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEdited(false);
    setDraft(percentage ? next.toFixed(2) : String(next));
    if (edited && (commitUnchanged || next !== value)) onCommit(next);
  };

  return (
    <div>
      <Input
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        type={percentage ? 'text' : 'number'}
        inputMode="decimal"
        min={min}
        max={max}
        step={10 ** -decimals}
        value={draft}
        disabled={disabled}
        className={className}
        onChange={(event) => {
          if (disabled) return;
          setDraft(event.target.value);
          setInvalid(false);
          setEdited(true);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(String(displayedValue));
            setInvalid(false);
            setEdited(false);
          }
        }}
      />
      {invalid && (
        <span role="alert" className="block text-xs text-destructive">
          Enter {min}–{max}, up to {decimals} decimals.
        </span>
      )}
    </div>
  );
}
