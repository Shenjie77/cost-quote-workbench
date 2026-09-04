import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-sm border border-input bg-[#fffdf9] px-2.5 py-2 text-xs shadow-none transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:bg-input/40 disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/25 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
