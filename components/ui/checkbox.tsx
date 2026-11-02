'use client';

import { layoutClassName } from '@/lib/ui-layout';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';

import { cn } from '@/lib/utils';
import { CheckIcon } from 'lucide-react';

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn('ui-checkbox', layoutClassName(className))}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={cn('ui-checkbox-indicator', layoutClassName(className))}
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
