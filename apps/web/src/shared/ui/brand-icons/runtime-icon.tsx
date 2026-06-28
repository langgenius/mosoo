import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import { getRuntimeIconUrl } from "./runtime-icon-data";

export { hasRuntimeIcon } from "./runtime-icon-data";

export function RuntimeIcon({
  className,
  runtimeId,
}: {
  className?: string;
  runtimeId: string;
}): ReactElement | null {
  const iconUrl = getRuntimeIconUrl(runtimeId);

  if (iconUrl === null) {
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
