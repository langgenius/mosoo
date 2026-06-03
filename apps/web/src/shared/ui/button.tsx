import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-semibold tracking-[0.01em] whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3.5",
        icon: "size-9 active:scale-100",
        "icon-lg": "size-10 active:scale-100",
        "icon-sm": "size-8 active:scale-100",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3 active:scale-100",
        lg: "h-11 rounded-md px-5 text-[15px] has-[>svg]:px-4",
        sm: "h-8 gap-1.5 rounded-md px-3 text-[13px] has-[>svg]:px-2.5",
        xs: "h-7 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
      },
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        accent: "bg-green-500 text-on-accent shadow-xs hover:bg-green-600",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        ghost: "text-fg-2 hover:bg-paper-200/60 hover:text-fg-1 active:scale-100",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
        outline:
          "border border-border-strong bg-card text-foreground hover:bg-paper-200 dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-paper-300/70",
        tonal: "bg-accent-soft text-accent-press hover:bg-accent-soft-hover",
      },
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }): ReactElement {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}

export { Button };
