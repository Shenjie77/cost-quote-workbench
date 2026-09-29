'use client';
import { formatMoney } from '@/lib/money';
import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';

/** Monetary inputs format at rest; editing and callbacks keep the original numeric value and precision. */
function Input({
  className,
  type,
  money = false,
  ...props
}: React.ComponentProps<'input'> & { money?: boolean }) {
  const [focused, setFocused] = React.useState(false);
  const displayed =
    money && !focused && props.value !== '' && props.value != null
      ? formatMoney(Number(String(props.value).replace(/,/g, '')))
      : props.value;
  return (
    <InputPrimitive
      type={money ? 'text' : type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-[13px] transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/25 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
      value={displayed}
      inputMode={money ? 'decimal' : props.inputMode}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        setFocused(false);
      }}
      onChange={(event) => {
        if (money) event.target.value = event.target.value.replace(/,/g, '');
        props.onChange?.(event);
      }}
    />
  );
}

export { Input };
