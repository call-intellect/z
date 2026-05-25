'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/utils';

/**
 * Button с CVA-вариантами. Brand-mint используется в `default` (primary CTA).
 * Стилизован под Z dark-first дизайн-систему.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-bg-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] active:transition-transform active:duration-75',
  {
    variants: {
      variant: {
        default:
          'bg-accent text-accent-fg shadow-glow hover:bg-accent-hover',
        secondary:
          'bg-bg-overlay text-fg-primary border border-border-subtle hover:bg-bg-card',
        outline:
          'border border-accent-border text-accent hover:bg-accent-muted',
        ghost: 'text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary',
        destructive:
          'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
        link: 'text-accent underline-offset-4 hover:underline px-0',
      },
      size: {
        // WHY min-h-10 md:min-h-Х: touch target ≥40px на mobile (WCAG 2.5.5),
        // на md+ возвращаем плотность desktop'а.
        sm: 'min-h-10 md:min-h-8 px-3 text-xs',
        default: 'min-h-10 md:min-h-9 px-4',
        lg: 'h-10 px-6 text-base',
        icon: 'min-h-10 min-w-10 md:min-h-9 md:min-w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
