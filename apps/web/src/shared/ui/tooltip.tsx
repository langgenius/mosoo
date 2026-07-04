"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { asChildRender } from "@/shared/ui/render-prop";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: Omit<ComponentProps<typeof TooltipPrimitive.Provider>, "delay"> & {
  delayDuration?: number;
}): ReactElement {
  return <TooltipPrimitive.Provider delay={delayDuration} {...props} />;
}

function Tooltip({ ...props }: ComponentProps<typeof TooltipPrimitive.Root>): ReactElement {
  return <TooltipPrimitive.Root {...props} />;
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Trigger> & { asChild?: boolean }): ReactElement {
  const render = asChildRender(asChild, children);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...(render ? { render } : { children })}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  side,
  align,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<
    ComponentProps<typeof TooltipPrimitive.Positioner>,
    "side" | "sideOffset" | "align"
  >): ReactElement {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="z-50"
        sideOffset={sideOffset}
        side={side}
        align={align}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "relative w-fit origin-(--transform-origin) rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 rotate-45 rounded-[2px] data-[side=bottom]:top-[-3px] data-[side=left]:right-[-3px] data-[side=right]:left-[-3px] data-[side=top]:bottom-[-3px]" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
