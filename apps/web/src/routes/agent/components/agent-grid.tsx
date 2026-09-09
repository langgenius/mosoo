import type { ReactElement } from "react";

import { AvatarFallback } from "@/shared/ui/avatar-fallback";
import { AvatarImage } from "@/shared/ui/avatar-image";
import { Avatar } from "@/shared/ui/avatar-root";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { RuntimeIcon } from "./runtime-icon";
import { StatusBadge } from "./status-badge";
import { ToolIcons } from "./tool-icons";

function getOwnerInitial(name: string): string {
  const initial = name.charAt(0).toUpperCase();
  return initial.length > 0 ? initial : "?";
}

export function AgentGrid({
  agents,
  onSelect,
  showOwner = false,
  className,
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
  showOwner?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div className={className}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {agents.map((agent) => {
          const runtime = getRuntimeInfo(agent.runtime);
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onSelect(agent.id);
              }}
              className="border-border bg-card hover:border-border-strong focus-visible:ring-ring cursor-pointer rounded-lg border p-4 text-left transition-[border-color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            >
              <div className="mb-3 flex items-start justify-between">
                <RuntimeIcon runtime={runtime} size={40} />
                <StatusBadge status={agent.status} />
              </div>

              <h3 className="text-fg-1 mb-1 text-[14.5px] font-semibold">{agent.name}</h3>

              <p className="text-fg-2 mb-4 line-clamp-2 min-h-[2lh] text-[12.5px] leading-relaxed">
                {agent.description}
              </p>

              <div className="flex min-w-0 items-center justify-between gap-2">
                <ToolIcons tools={agent.tools} />
                {showOwner && (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Avatar size="sm" className="size-5">
                      {agent.owner.avatar !== undefined && agent.owner.avatar.length > 0 ? (
                        <AvatarImage
                          src={agent.owner.avatar}
                          alt={agent.owner.name}
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <AvatarFallback className="bg-brand-soft text-brand text-[9px]">
                        {getOwnerInitial(agent.owner.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-fg-3 truncate text-[11px]">
                      {agent.owner.name.split(" ")[0]}
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
