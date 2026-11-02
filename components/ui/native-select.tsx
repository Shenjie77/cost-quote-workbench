import { layoutClassName } from '@/lib/ui-layout';
import { useFieldVariant } from './field-surface';
import * as React from 'react';

import { cn } from '@/lib/utils';
import { ChevronDownIcon } from 'lucide-react';

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default';
};

function NativeSelect({
  className,
  size = 'default',
  ...props
}: NativeSelectProps) {
  const fieldVariant = useFieldVariant();
  return (
    <div
      className={cn(
        'group/native-select relative w-fit has-[select:disabled]:opacity-50',
        layoutClassName(className),
      )}
      data-slot="native-select-wrapper"
      data-size={size}
    >
      <select
        data-slot="native-select"
        data-field-variant={fieldVariant}
        data-size={size}
        className={cn(
          'ui-select appearance-none pr-8',
          fieldVariant === 'grid' && 'ui-select-grid',
        )}
        {...props}
      />
      <ChevronDownIcon
        className="text-muted-foreground top-1/2 right-3 size-4 -translate-y-1/2 pointer-events-none absolute select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  );
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-card text-foreground', className)}
      {...props}
    />
  );
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-card text-foreground', className)}
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
