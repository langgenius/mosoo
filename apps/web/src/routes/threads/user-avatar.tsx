import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

export function UserAvatar({
  className,
  image,
  name,
}: {
  className?: string;
  image: string | null;
  name: string;
}): ReactElement {
  const sizeClassName = className ?? "size-5 text-[9px] font-bold";

  if (image !== null && image.length > 0) {
    return (
      <img
        src={image}
        alt={name}
        referrerPolicy="no-referrer"
        className={cn("shrink-0 rounded-md object-cover", sizeClassName)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md font-bold text-white",
        "bg-[linear-gradient(135deg,var(--green-600),var(--green-800))]",
        sizeClassName,
      )}
    >
      {name.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
