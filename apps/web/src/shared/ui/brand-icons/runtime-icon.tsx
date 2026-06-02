import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import { RUNTIME_ICON_URL } from "./runtime-icon-data";

export { hasRuntimeIcon } from "./runtime-icon-data";

export function RuntimeIcon({
  className,
  runtimeId,
}: {
  className?: string;
  runtimeId: string;
}): ReactElement | null {
  const iconUrl = RUNTIME_ICON_URL[runtimeId];

  if (iconUrl === undefined) {
    return null;
  }

  return (
    <img
      aria-hidden
      alt=""
      className={cn("inline-block object-contain", className)}
      src={iconUrl}
    />
  );
}
