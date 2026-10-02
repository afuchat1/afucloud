import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2',
  {
    variants: {
      variant: {
        default:
          'border-white/30 bg-[#076f47]/95 text-white shadow-[0_5px_14px_rgba(7,79,51,0.24),inset_0_1px_0_rgba(255,255,255,0.34)] backdrop-blur-md hover:bg-[#065e3d] dark:bg-[#076f47]/95 dark:hover:bg-[#065e3d]',
        destructive:
          'border-white/25 bg-[#b42323] text-white shadow-[0_5px_14px_rgba(100,20,20,0.22),inset_0_1px_0_rgba(255,255,255,0.28)] backdrop-blur-md hover:bg-[#981b1b]',
        outline:
          'border-foreground/15 bg-background/75 text-foreground shadow-[0_4px_12px_rgba(20,35,27,0.09),inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-md hover:bg-background/95',
        secondary:
          'border-border/80 bg-secondary/90 text-secondary-foreground shadow-[0_4px_12px_rgba(20,35,27,0.08),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur-md hover:bg-secondary',
        ghost:
          'border-border/70 bg-background/55 text-foreground shadow-[0_3px_10px_rgba(20,35,27,0.07),inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-md hover:bg-background/85',
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
