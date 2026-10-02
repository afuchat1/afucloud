import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2',
  {
    variants: {
      variant: {
        default:
          'border-white/35 bg-[#08764b]/95 text-white shadow-[0_5px_16px_rgba(7,79,51,0.22),inset_0_1px_0_rgba(255,255,255,0.38)] backdrop-blur-xl hover:border-white/45 hover:bg-[#06613f] hover:shadow-[0_7px_20px_rgba(7,79,51,0.25),inset_0_1px_0_rgba(255,255,255,0.42)] dark:border-white/20 dark:bg-[#0b8054]/95 dark:text-white dark:hover:bg-[#0d9160]',
        destructive:
          'border-white/30 bg-[#b42323]/95 text-white shadow-[0_5px_14px_rgba(100,20,20,0.2),inset_0_1px_0_rgba(255,255,255,0.3)] backdrop-blur-xl hover:bg-[#981b1b] dark:border-red-200/20 dark:bg-[#b93838]/95 dark:hover:bg-[#ca4444]',
        outline:
          'border-foreground/15 bg-background/80 text-foreground shadow-[0_4px_14px_rgba(20,35,27,0.09),inset_0_1px_0_rgba(255,255,255,0.72)] backdrop-blur-xl hover:border-foreground/25 hover:bg-background/95 hover:shadow-[0_6px_18px_rgba(20,35,27,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] dark:border-white/15 dark:bg-white/[0.09] dark:text-foreground dark:shadow-[0_4px_14px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.1)] dark:hover:border-white/25 dark:hover:bg-white/[0.14]',
        secondary:
          'border-border/80 bg-secondary/90 text-secondary-foreground shadow-[0_4px_12px_rgba(20,35,27,0.08),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-xl hover:border-border hover:bg-secondary dark:border-white/10 dark:bg-white/[0.1] dark:text-foreground dark:hover:bg-white/[0.16]',
        ghost:
          'border-border/70 bg-background/55 text-foreground shadow-[0_3px_10px_rgba(20,35,27,0.06),inset_0_1px_0_rgba(255,255,255,0.48)] backdrop-blur-xl hover:border-border hover:bg-background/90 dark:border-white/10 dark:bg-white/[0.06] dark:text-foreground dark:shadow-[0_3px_10px_rgba(0,0,0,0.16),inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/[0.12]',
        link: 'border-transparent bg-transparent text-primary shadow-none backdrop-blur-none underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-10 px-5 py-2',
        sm: 'min-h-9 px-4 text-xs',
        lg: 'min-h-11 px-8',
        icon: 'h-10 w-10 min-h-10 px-0 py-0',
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

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
