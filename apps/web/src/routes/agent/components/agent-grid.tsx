import type { ReactElement } from "react";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { RuntimeIcon } from "./runtime-icon";
import { StatusBadge } from "./status-badge";
import { ToolIcons } from "./tool-icons";

export function AgentGrid({
  agents,
  onSelect,
}: {
  agents: Agent[];
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div>
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
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
