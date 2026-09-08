import type { ComponentProps, ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { fieldClassName } from "@/shared/ui/input";

function Textarea({ className, ...props }: ComponentProps<"textarea">): ReactElement {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldClassName,
        "field-sizing-content h-auto min-h-16 py-2 leading-5",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
