import { useFieldVariant } from './field-surface';
import * as React from 'react';

import { layoutClassName } from '@/lib/ui-layout';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  const fieldVariant = useFieldVariant();
  return (
    <textarea
      data-slot="textarea"
      data-field-variant={fieldVariant}
      className={cn(
        'ui-textarea field-sizing-content',
        fieldVariant === 'grid' && 'ui-textarea-grid',
        layoutClassName(className),
      )}
      {...props}
    />
  );
}

export { Textarea };
