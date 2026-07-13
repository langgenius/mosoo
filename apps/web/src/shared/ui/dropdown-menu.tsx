import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { asChildRender } from "@/shared/ui/render-prop";

function DropdownMenu({
  modal = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Root>): ReactElement {
  return <MenuPrimitive.Root modal={modal} {...props} />;
}

function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.Trigger> & { asChild?: boolean }): ReactElement {
  const render = asChildRender(asChild, children);
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...(render ? { render } : { children })}
      {...props}
    />
  );
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  side,
  align,
  alignOffset,
  ...props
}: ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<
    ComponentProps<typeof MenuPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  >): ReactElement {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="z-50"
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  asChild,
  onSelect,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
  asChild?: boolean;
  /** Radix compatibility: fires on click / keyboard select and closes the menu. */
  onSelect?: (event: Event) => void;
}): ReactElement {
  const render = asChildRender(asChild, children);
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onClick={
        onSelect
          ? (event) => {
              onSelect(event.nativeEvent);
              // Preserve Radix's contract: calling preventDefault() inside onSelect
              // keeps the menu open. Base UI closes on click unless its own handler
              // is cancelled via preventBaseUIHandler().
              if (event.nativeEvent.defaultPrevented) {
                event.preventBaseUIHandler();
              }
            }
          : undefined
      }
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive",
        className,
      )}
      {...(render ? { render } : { children })}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>): ReactElement {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<"div"> & { inset?: boolean }): ReactElement {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground data-[inset]:pl-8",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
