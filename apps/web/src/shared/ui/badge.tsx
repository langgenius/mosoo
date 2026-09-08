import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { isValidElement } from "react";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Badge recipe (docs/design/console-design-contract.md, section 4): 20px tall,
 * 6px radius, 11.5px semibold. Status variants pair a tint with a text tone
 * that clears 4.5:1 on it; `brand` is reserved for Mosoo-specific lifecycle
 * markers (default key, built-in resource). Success, warning, danger, and
 * pending should carry a glyph as well as a colour when they stand alone.
 */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent px-2 text-[11.5px] leading-none font-semibold tracking-[0.01em] whitespace-nowrap transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 [&>svg]:pointer-events-none [&>svg]:size-3 [&>svg]:shrink-0",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        brand: "bg-brand-soft text-brand [a&]:hover:bg-brand-soft-hover",
        danger: "bg-danger-bg text-danger-fg [a&]:hover:bg-danger-bg/70",
        default: "bg-paper-200 text-fg-2 [a&]:hover:bg-paper-300",
        destructive: "bg-danger text-white [a&]:hover:bg-danger/90",
        ghost: "text-fg-2 [a&]:hover:bg-hover [a&]:hover:text-fg-1",
        info: "bg-info-bg text-info-fg [a&]:hover:bg-info-bg/70",
        link: "text-link underline underline-offset-2 [a&]:hover:text-link-hover",
        outline: "border-border-strong bg-card text-fg-2 [a&]:hover:bg-paper-100",
        pending: "bg-pending-bg text-pending-fg [a&]:hover:bg-paper-300",
        /** Legacy alias of `brand`. */
        primary: "bg-brand-soft text-brand [a&]:hover:bg-brand-soft-hover",
        /** Legacy alias of `default`. */
        secondary: "bg-paper-200 text-fg-2 [a&]:hover:bg-paper-300",
        soil: "bg-soil-bg text-soil-fg [a&]:hover:bg-soil-bg/70",
        success: "bg-success-bg text-success-fg [a&]:hover:bg-success-bg/70",
        warning: "bg-warning-bg text-warning-fg [a&]:hover:bg-warning-bg/70",
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
