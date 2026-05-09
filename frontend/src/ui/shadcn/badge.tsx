import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-xs border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-accent-muted text-accent border-accent-border',
        secondary:
          'border-border-subtle bg-bg-overlay text-fg-secondary',
        outline:
          'border-border text-fg-secondary',
        success:
          'border-success/30 bg-success/15 text-success',
        warning:
          'border-warning/30 bg-warning/15 text-warning',
        danger:
          'border-danger/30 bg-danger/15 text-danger',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
