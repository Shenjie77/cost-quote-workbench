import { useFieldVariant } from './field-surface';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { fieldLayoutClassName } from '@/lib/ui-layout';

/** Native select for dense grids and forms; shares the same input appearance contract. */
export function SelectField({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'select'> & { variant?: 'default' | 'grid' }) {
  const fieldVariant = useFieldVariant(variant);
  return (
    <select
      data-slot="native-select"
      data-field-variant={fieldVariant}
      className={cn(
        'ui-select',
        fieldVariant === 'grid' && 'ui-select-grid',
        fieldLayoutClassName(className),
      )}
      {...props}
    />
  );
}
