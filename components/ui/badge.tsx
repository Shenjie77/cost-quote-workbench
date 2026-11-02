import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { layoutClassName } from '@/lib/ui-layout';
import { cn } from '@/lib/utils';

const badgeVariants = cva('ui-badge', {
  variants: {
    variant: {
      default: '',
      secondary: '',
      destructive: '',
      outline: '',
      ghost: '',
      link: '',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({
  className,
  variant = 'default',
  tone = 'neutral',
  render,
  ...props
}: useRender.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
  }) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), layoutClassName(className)),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      tone,
      variant,
    },
  });
}

export { Badge, badgeVariants };
