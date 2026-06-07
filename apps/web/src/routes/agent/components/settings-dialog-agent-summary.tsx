import type { ReactElement } from "react";

import { Input } from "@/shared/ui/input";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { AgentIdBadge } from "./agent-id-badge";
import { RuntimeIcon } from "./runtime-icon";

export function AgentSettingsSummary({ agent }: { agent: Agent }): ReactElement {
  const runtime = getRuntimeInfo(agent.runtime);

  return (
    <div className="flex items-center gap-4">
      <div className="shadow-xs rounded-lg">
        <RuntimeIcon runtime={runtime} size={48} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <Input defaultValue={agent.name} className="h-9 rounded-md text-sm font-medium" />
        <Input
          className="text-muted-foreground h-9 rounded-md text-sm"
          defaultValue={agent.description}
          placeholder="Description..."
        />
        {agent.status === "published" ? (
          <AgentIdBadge agentId={agent.id} className="w-fit" />
        ) : null}
      </div>
    </div>
  );
}
