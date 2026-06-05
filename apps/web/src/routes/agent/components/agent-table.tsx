import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { AvatarFallback } from "@/shared/ui/avatar-fallback";
import { AvatarImage } from "@/shared/ui/avatar-image";
import { Avatar } from "@/shared/ui/avatar-root";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { AgentIdBadge } from "./agent-id-badge";
import { AgentRowActions } from "./agent-row-actions";
import { RuntimeIcon } from "./runtime-icon";
import { StatusBadge } from "./status-badge";
import { ToolIcons } from "./tool-icons";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function getOwnerInitial(name: string): string {
  const initial = name.charAt(0).toUpperCase();
  return initial.length > 0 ? initial : "?";
}

export function AgentTable({
  agents,
  onSelect,
  organizationId,
  showOwner = false,
  className,
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
  organizationId: string | null;
  showOwner?: boolean;
  className?: string;
}): ReactElement {
  const gridCols = showOwner
    ? "grid-cols-[1fr_160px_120px_180px_140px_48px]"
    : "grid-cols-[1fr_160px_120px_140px_48px]";

  return (
    <div className={className}>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <div className={cn("grid h-10 items-center px-4 border-b border-border", gridCols)}>
          <span className="text-fg-3 text-[11px] font-extrabold tracking-[0.1em] uppercase">
            Agent
          </span>
          <span className="text-fg-3 text-[11px] font-extrabold tracking-[0.1em] uppercase">
            Tools
          </span>
          <span className="text-fg-3 text-[11px] font-extrabold tracking-[0.1em] uppercase">
            Status
          </span>
          {showOwner && (
            <span className="text-fg-3 text-[11px] font-extrabold tracking-[0.1em] uppercase">
              Owner
            </span>
          )}
          <span className="text-fg-3 text-[11px] font-extrabold tracking-[0.1em] uppercase">
            Created
          </span>
          <span />
        </div>

        {agents.map((agent, index) => {
          const runtime = getRuntimeInfo(agent.runtime);
          return (
            <div
              key={agent.id}
              className={cn(
                "grid items-center px-4 h-14 hover:bg-paper-50 transition-colors",
                gridCols,
                index !== agents.length - 1 && "border-b border-border-soft",
              )}
            >
              <button
                aria-label={`Open ${agent.name}`}
                className="contents cursor-pointer text-left"
                onClick={() => {
                  onSelect(agent.id);
                }}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <RuntimeIcon runtime={runtime} size={32} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-fg-1 truncate text-[14px] font-bold">{agent.name}</span>
                      {agent.status === "published" ? (
                        <AgentIdBadge agentId={agent.id} className="shrink-0" />
                      ) : null}
                    </div>
                    <div className="text-fg-2 max-w-[320px] truncate text-[12.5px]">
                      {agent.description}
                    </div>
                  </div>
                </div>

                <ToolIcons tools={agent.tools} />

                <StatusBadge status={agent.status} />

                {showOwner && (
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar size="sm">
                      {agent.owner.avatar !== undefined && agent.owner.avatar.length > 0 ? (
                        <AvatarImage
                          src={agent.owner.avatar}
                          alt={agent.owner.name}
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                        {getOwnerInitial(agent.owner.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-fg-2 truncate text-[12.5px]">{agent.owner.name}</span>
                  </div>
                )}

                <span className="text-fg-3 font-mono text-[12px]">
                  {formatDate(agent.createdAt)}
                </span>
              </button>

              <AgentRowActions agent={agent} organizationId={organizationId} />
            </div>
          );
        })}

        {agents.length === 0 && (
          <div className="text-fg-3 py-12 text-center text-[13px]">No agents found.</div>
        )}
      </div>
    </div>
  );
}
