import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Switch recipe (docs/design/console-design-contract.md, section 4): 24 x 14
 * track, 10px thumb inset by 2px. The checked track is the `control-checked`
 * state token (deep brand tone, 3:1 on white); unchecked is a neutral. A
 * disabled switch lightens the track and keeps the thumb, so on and off stay
 * distinguishable without fading the control.
 */
function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>): ReactElement {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-3.5 w-6 shrink-0 cursor-pointer items-center rounded-full outline-none transition-[background-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed data-[checked]:bg-control-checked data-[unchecked]:bg-control-unchecked data-[checked]:disabled:bg-green-300 data-[unchecked]:disabled:bg-paper-300",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-2.5 rounded-full bg-white shadow-xs transition-transform duration-150 ease-out data-[checked]:translate-x-3 data-[unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
