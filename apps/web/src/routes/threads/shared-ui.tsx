import type { AgentSummary } from "@mosoo/contracts/agent";
import { CheckCircle2, CircleDashed, CircleX } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";
import { hasRuntimeIcon, RuntimeIcon } from "@/shared/ui/brand-icons";

import type { ThreadStateGlyph } from "./model/thread";

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

export function ThreadStateIcon({ glyph }: { glyph: ThreadStateGlyph }): ReactElement {
  switch (glyph) {
    case "archived": {
      return <CircleDashed className="text-fg-3 size-3.5 shrink-0" aria-label="Archived" />;
    }
    case "failed": {
      return <CircleX className="text-destructive size-3.5 shrink-0" aria-label="Failed" />;
    }
    case "success": {
      return <CheckCircle2 className="text-primary size-3.5 shrink-0" aria-label="Completed" />;
    }
    case "working": {
      return (
        <svg
          aria-label="Working"
          className="relative inline-block size-3.5 shrink-0"
          viewBox="0 0 14 14"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="7" cy="7" r="4" className="fill-primary opacity-70">
            <animate attributeName="r" values="3;5;3" dur="1s" repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              values="0.7;0.2;0.7"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="7" cy="7" r="4" className="fill-primary" />
        </svg>
      );
    }
  }
}
