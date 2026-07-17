import { Search } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";
import { Input } from "@/shared/ui/input";

export function ListPageToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 px-4 pb-4 sm:px-8 [&_button]:min-h-10 sm:[&_button]:min-h-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListPageToolbarSpacer(): ReactElement {
  return <div className="flex-1" />;
}

export function ListPageSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("relative w-full sm:w-[260px]", className)}>
      <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
      <Input
        className="h-8 pl-9"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

export function ListPageContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("flex-1 overflow-y-auto px-4 pb-8 sm:px-8", className)}>{children}</div>
  );
}
