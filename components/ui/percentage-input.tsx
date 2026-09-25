/** Manual percentage input: preserve precise saved values until an explicit edit, and format committed values to two decimals. */
import { useState } from 'react';
import { Input } from './input';
import type { ComponentProps } from 'react';

type PercentageInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type'
> & {
  value: number;
  onChange: (event: { target: { value: string } }) => void;
};

/** Keep partial text local, commit valid numbers on blur/Enter, and restore the saved value on Escape. */
export function PercentageInput({
  value,
  onChange,
  disabled,
  min,
  max,
  ...props
}: PercentageInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    if (disabled || draft === null) return;
    const number = Number(draft);
    if (
      !draft.trim() ||
      !Number.isFinite(number) ||
      (min !== undefined && number < Number(min)) ||
      (max !== undefined && number > Number(max))
    ) {
      setInvalid(true);
      return;
    }
    if (number !== value) onChange({ target: { value: String(number) } });
    setDraft(null);
    setInvalid(false);
  };
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      min={min}
      max={max}
      disabled={disabled}
      aria-invalid={invalid}
      value={draft ?? value.toFixed(2)}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(null);
          setInvalid(false);
        }
      }}
    />
  );
}
