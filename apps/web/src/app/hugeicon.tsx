import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsIconProps, IconSvgElement } from "@hugeicons/react";
import { forwardRef } from "react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";

type HugeiconProps = Omit<HugeiconsIconProps, "altIcon" | "icon">;

export type AppIcon = ForwardRefExoticComponent<HugeiconProps & RefAttributes<SVGSVGElement>>;

export function createHugeicon(icon: IconSvgElement, displayName: string): AppIcon {
  const Component = forwardRef<SVGSVGElement, HugeiconProps>(function AppHugeicon(
    { color = "currentColor", strokeWidth = 1.5, ...props },
    ref,
  ) {
    return (
      <HugeiconsIcon ref={ref} icon={icon} color={color} strokeWidth={strokeWidth} {...props} />
    );
  });

  Component.displayName = displayName;

  return Component;
}
