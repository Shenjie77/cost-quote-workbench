'use client';
import { useFieldVariant } from './field-surface';
import { formatMoney } from '@/lib/money';
import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';
import { fieldLayoutClassName } from '@/lib/ui-layout';

/** Monetary inputs format at rest; editing and callbacks keep the original numeric value and precision. */
function Input({
  className,
  type,
  money = false,
  variant = 'default',
  ...props
}: React.ComponentProps<'input'> & {
  money?: boolean;
  variant?: 'default' | 'grid' | 'search';
}) {
  const fieldVariant = useFieldVariant(variant);
  const [focused, setFocused] = React.useState(false);
  const displayed =
    money && !focused && props.value !== '' && props.value != null
      ? formatMoney(Number(String(props.value).replace(/,/g, '')))
      : props.value;
  return (
    <InputPrimitive
      type={money ? 'text' : type}
      data-slot="input"
      data-field-variant={fieldVariant}
      className={cn(
        'ui-input',
        fieldVariant === 'grid' && 'ui-input-grid',
        fieldVariant === 'search' && 'ui-input-search',
        fieldLayoutClassName(className),
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
