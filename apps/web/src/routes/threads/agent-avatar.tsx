import type { AgentSummary } from "@mosoo/contracts/agent";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";
import { hasRuntimeIcon, RuntimeIcon } from "@/shared/ui/brand-icons";

function getAgentInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return initials || "A";
}

export function AgentAvatar({
  agent,
  className,
  defaultName,
  placeholder,
}: {
  agent: AgentSummary | null;
  className?: string;
  defaultName: string;
  placeholder?: ReactNode;
}): ReactElement {
  const runtimeId = agent?.runtimeId ?? "";
  const showIcon = runtimeId.length > 0 && hasRuntimeIcon(runtimeId);

  return (
    <span
      className={cn(
        "bg-card text-fg-2 border-border-subtle flex shrink-0 items-center justify-center overflow-hidden rounded-md border font-bold",
        className ?? "size-5 text-[9px] font-bold",
      )}
    >
      {agent === null && placeholder !== undefined ? (
        placeholder
      ) : showIcon ? (
        <RuntimeIcon runtimeId={runtimeId} className="size-full p-0.5" />
      ) : (
        getAgentInitials(agent?.name ?? defaultName)
      )}
    </span>
  );
}
