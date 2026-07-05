import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { isValidElement } from "react";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-[11.5px] font-bold tracking-[0.02em] whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        danger:
          "bg-destructive/12 text-destructive focus-visible:ring-destructive/20 [a&]:hover:bg-destructive/20",
        default: "bg-secondary text-fg-2 [a&]:hover:bg-paper-300",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
        outline:
          "border-border-strong text-fg-2 [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        primary: "bg-accent-soft text-accent-press [a&]:hover:bg-green-100",
        secondary: "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        soil: "bg-soil-bg text-soil-fg [a&]:hover:bg-soil-bg/70",
        success: "bg-success-bg text-success-fg [a&]:hover:bg-success-bg/70",
        warning: "bg-amber-bg text-amber-fg [a&]:hover:bg-amber-bg/70",
      },
    },
  },
);

type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Radix-style escape hatch: render the single child element as the badge. */
    asChild?: boolean;
    /** Base UI native composition: element (or render fn) to render instead of a span. */
    render?: useRender.RenderProp;
  };

function Badge({
  className,
  variant = "default",
  asChild = false,
  render,
  children,
  ...props
}: BadgeProps): ReactElement {
  // `asChild` uses the single child element AS the rendered element (its own
  // children come with it); the native `render` prop instead keeps `children`
  // as separate content Base UI merges into the render target.
  const asChildElement =
    asChild && isValidElement(children) ? (children as ReactElement) : undefined;

  return useRender({
    render: render ?? asChildElement,
    defaultTagName: "span",
    props: {
      "data-slot": "badge",
      "data-variant": variant,
      className: cn(badgeVariants({ variant }), className),
      ...props,
      ...(asChildElement ? {} : { children }),
    },
  });
}

export { Badge };
