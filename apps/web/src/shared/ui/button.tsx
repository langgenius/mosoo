import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { isValidElement } from "react";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Button recipe (docs/design/console-design-contract.md, section 4).
 *
 * Density ladder: default 32px / 6px radius, sm 28px / 4px, xs 24px / 4px,
 * lg 36px / 6px; icon sizes mirror the same heights. Buttons are flat at
 * rest (no shadow; the border carries the edge). `default` is the one
 * focal action per surface (brand green fill, dark ink text); everything
 * else stays neutral. States: rest, hover (enabled only), pressed, keyboard
 * focus (the shared 2px ring), disabled (surface and text change, never a
 * whole-control opacity fade), busy (`aria-busy`, callers swap the leading
 * glyph for a spinner). Transitions are targeted; there is no press scale.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 rounded-md px-3 text-[13px] has-[>svg]:px-2.5",
        icon: "size-8 rounded-md",
        "icon-lg": "size-9 rounded-md",
        "icon-sm": "size-7 rounded-sm",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 rounded-md px-4 text-[14px] has-[>svg]:px-3.5",
        sm: "h-7 rounded-sm px-2.5 text-[12.5px] has-[>svg]:px-2",
        xs: "h-6 rounded-sm px-2 text-[12px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
      },
      variant: {
        /** The focal action: brand green fill, dark ink text, deep-tone hairline. */
        default:
          "border border-primary-border bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:border-transparent disabled:bg-paper-300 disabled:text-fg-3",
        /** Legacy alias of `default`; new call sites use `default`. */
        accent:
          "border border-primary-border bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:border-transparent disabled:bg-paper-300 disabled:text-fg-3",
        destructive:
          "bg-danger text-white hover:bg-danger/90 active:bg-danger/80 disabled:bg-paper-300 disabled:text-fg-3",
        ghost:
          "text-fg-2 hover:bg-hover hover:text-fg-1 active:bg-pressed disabled:bg-transparent disabled:text-fg-muted",
        link: "h-auto rounded-none px-0 text-link underline decoration-link/45 underline-offset-[3px] hover:text-link-hover hover:decoration-current disabled:text-fg-muted",
        outline:
          "border border-border-strong bg-card text-fg-1 hover:bg-paper-100 active:bg-paper-200 disabled:border-border-soft disabled:bg-paper-100 disabled:text-fg-muted",
        secondary:
          "bg-paper-200 text-fg-1 hover:bg-paper-300 active:bg-paper-400 disabled:bg-paper-200 disabled:text-fg-muted",
        tonal:
          "bg-brand-soft text-brand hover:bg-brand-soft-hover active:bg-green-200 disabled:bg-paper-200 disabled:text-fg-muted",
      },
    },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Radix-style escape hatch: render the single child element as the button. */
    asChild?: boolean;
    /** Base UI native composition: element (or render fn) to render instead of a button. */
    render?: useRender.RenderProp;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  render,
  children,
  ...props
}: ButtonProps): ReactElement {
  // `asChild` uses the single child element AS the rendered element (its own
  // children come with it), so they must not also be passed as a prop. The
  // native `render` prop is different: `children` is separate content Base UI
  // merges into the render target, so it must be forwarded.
  const asChildElement =
    asChild && isValidElement(children) ? (children as ReactElement) : undefined;

  return useRender({
    render: render ?? asChildElement,
    defaultTagName: "button",
    props: {
      "data-slot": "button",
      "data-variant": variant,
      "data-size": size,
      className: cn(buttonVariants({ className, size, variant })),
      ...props,
      ...(asChildElement ? {} : { children }),
    },
  });
}

export { Button };
