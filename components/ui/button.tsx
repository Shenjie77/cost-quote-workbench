import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { controlLayoutClassName } from '@/lib/ui-layout';

const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      default: 'ui-button-primary',
      outline: 'ui-button-outline',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      navigation: 'ui-button-navigation',
      destructive: 'ui-button-destructive',
      link: 'ui-button-link',
    },
    size: {
      default: '',
      xs: 'ui-button-sm',
      sm: 'ui-button-sm',
      lg: 'ui-button-lg',
      icon: 'ui-button-icon',
      'icon-xs': 'ui-button-icon-sm',
      'icon-sm': 'ui-button-icon',
      'icon-lg': 'ui-button-icon-lg',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size }),
        controlLayoutClassName(className),
      )}
      {...props}
    />
  );
}

export { Button, buttonVariants };
