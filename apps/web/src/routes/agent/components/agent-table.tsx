import type { ReactElement } from "react";

import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { AgentRowActions } from "./agent-row-actions";
import { RuntimeIcon } from "./runtime-icon";
import { StatusBadge } from "./status-badge";
import { ToolIcons } from "./tool-icons";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(getCurrentLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function AgentTable({
  agents,
  onSelect,
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const gridCols =
    "grid-cols-[minmax(0,1fr)_auto_32px] lg:grid-cols-[minmax(0,1fr)_160px_120px_140px_48px]";

  return (
    <div>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <div
          className={cn(
            "border-border grid h-10 items-center border-b px-4 text-[12px] font-medium text-fg-2",
            gridCols,
          )}
        >
          <span>{t("agent.agent")}</span>
          <span className="hidden lg:block">{t("agent.tools")}</span>
          <span>{t("agent.status")}</span>
          <span className="hidden lg:block">{t("agent.created")}</span>
          <span />
        </div>

        {agents.map((agent, index) => {
          const runtime = getRuntimeInfo(agent.runtime);
          return (
            <div
              key={agent.id}
              className={cn(
                "grid h-14 items-center px-4 transition-[background-color] duration-150 ease-out hover:bg-hover",
                gridCols,
                index !== agents.length - 1 && "border-b border-border-soft",
              )}
            >
              <button
                aria-label={t("agent.openAgent", { name: agent.name })}
                className="contents cursor-pointer text-left"
                onClick={() => {
                  onSelect(agent.id);
                }}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <RuntimeIcon runtime={runtime} size={32} />
                  <div className="min-w-0">
                    <div className="text-fg-heading truncate text-[13px] font-medium">
                      {agent.name}
                    </div>
                    <div className="text-fg-3 max-w-[360px] truncate text-[12px]">
                      {agent.description}
                    </div>
                  </div>
                </div>

                <div className="hidden lg:block">
                  <ToolIcons tools={agent.tools} />
                </div>

                <StatusBadge status={agent.status} />

                <span className="text-fg-3 hidden font-mono text-[12px] lg:inline">
                  {formatDate(agent.createdAt)}
                </span>
              </button>

              <AgentRowActions agent={agent} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
