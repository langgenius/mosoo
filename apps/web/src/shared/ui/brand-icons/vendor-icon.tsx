import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

import { VENDOR_ICON_URL } from "./vendor-icon-data";

export function VendorIcon({
  className,
  vendorId,
}: {
  className?: string;
  vendorId: string;
}): ReactElement | null {
  const iconUrl = VENDOR_ICON_URL[vendorId];

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
