import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        success: 'bg-success/15 text-success',
        warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        destructive: 'bg-destructive/15 text-destructive',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
