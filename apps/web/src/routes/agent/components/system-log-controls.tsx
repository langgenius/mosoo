import { Check, ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import type { AgentRuntimeEventFamily } from "@/gql/graphql";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  SYSTEM_LOG_RUNTIME_EVENT_FAMILIES,
  SYSTEM_LOG_RUNTIME_EVENT_FAMILY_OPTIONS,
  formatFamilyFilterLabel,
} from "./system-log-model";

export function FamilyFilterDropdown({
  selectedFamilies,
  onReset,
  onToggle,
}: {
  onReset: () => void;
  onToggle: (family: AgentRuntimeEventFamily) => void;
  selectedFamilies: ReadonlySet<AgentRuntimeEventFamily>;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Filter system log families">
          {formatFamilyFilterLabel(selectedFamilies)}
          <ChevronDown aria-hidden="true" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Families</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onReset();
          }}
          className="text-[12px]"
        >
          <span className="flex size-4 items-center justify-center">
            {selectedFamilies.size === SYSTEM_LOG_RUNTIME_EVENT_FAMILIES.length ? (
              <Check aria-hidden="true" size={14} />
            ) : null}
          </span>
          All families
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {SYSTEM_LOG_RUNTIME_EVENT_FAMILY_OPTIONS.map((family) => {
          const selected = selectedFamilies.has(family.value);

          return (
            <DropdownMenuItem
              key={family.value}
              onSelect={(event) => {
                event.preventDefault();
                onToggle(family.value);
              }}
              className="text-[12px]"
            >
              <span className="flex size-4 items-center justify-center">
                {selected ? <Check aria-hidden="true" size={14} /> : null}
              </span>
              <span>{family.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
