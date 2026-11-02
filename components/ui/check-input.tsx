import type { ComponentProps } from 'react';
import { layoutClassName } from '@/lib/ui-layout';
export function CheckInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input className={`ui-check ${layoutClassName(className)}`} {...props} />
  );
}
