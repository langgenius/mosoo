"use client";

import { Avatar as AvatarPrimitive } from "radix-ui";
import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

export function AvatarFallback({
  className,
  ...props
}: ComponentProps<typeof AvatarPrimitive.Fallback>): ReactElement {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--green-600),var(--green-800))] text-sm font-bold tracking-[0.02em] text-white group-data-[size=sm]/avatar:text-xs",
        className,
      )}
      {...props}
    />
  );
}
