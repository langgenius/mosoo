import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsIconProps, IconSvgElement } from "@hugeicons/react";
import type { ComponentType, Ref } from "react";

type HugeiconProps = Omit<HugeiconsIconProps, "altIcon" | "icon"> & {
  ref?: Ref<SVGSVGElement>;
};

export type AppIcon = ComponentType<HugeiconProps>;

export function createHugeicon(icon: IconSvgElement, displayName: string): AppIcon {
  function AppHugeicon({
    color = "currentColor",
    ref,
    strokeWidth = 1.5,
    ...props
  }: HugeiconProps) {
    return (
      <HugeiconsIcon ref={ref} icon={icon} color={color} strokeWidth={strokeWidth} {...props} />
    );
  }

  AppHugeicon.displayName = displayName;

  return AppHugeicon;
}
