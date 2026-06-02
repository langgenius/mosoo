import type { SpaceRole } from "@mosoo/contracts/space";
import { ChevronDown } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { ROLE_LABELS, ROLE_ORDER } from "./constants";

export function RoleSelect({
  onChange,
  onRemove,
  showRemove,
  value,
}: {
  onChange: (role: SpaceRole) => void;
  onRemove?: () => void;
  showRemove?: boolean;
  value: SpaceRole;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors outline-none focus-visible:ring-2"
        >
          {ROLE_LABELS[value] ?? value}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-36 rounded-lg p-1">
        {ROLE_ORDER.map((role) => (
          <DropdownMenuItem
            key={role}
            onSelect={() => {
              onChange(role);
            }}
            className={cn("text-xs", value === role && "text-primary font-medium")}
          >
            {ROLE_LABELS[role]}
          </DropdownMenuItem>
        ))}
        {showRemove === true ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onRemove?.()}
              className="text-xs"
            >
              Remove access
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
