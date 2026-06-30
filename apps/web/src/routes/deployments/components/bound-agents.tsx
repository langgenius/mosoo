import { Bot } from "lucide-react";

import { Badge } from "@/shared/ui/badge";

import type { BoundAgentVM } from "../deploy-console-data";

function AgentCard({ agent }: { agent: BoundAgentVM }) {
  return (
    <div className="border-border bg-background flex items-start gap-3 rounded-md border px-3 py-2.5">
      <span className="bg-accent-soft text-accent-press mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-fg-1 text-sm font-semibold">{agent.name}</span>
          <Badge variant="primary">{agent.expose}</Badge>
        </div>
        <div className="text-fg-3 mt-0.5 text-[12.5px]">
          <span className="font-mono">{agent.id}</span> · injects{" "}
          <span className="text-fg-2 font-mono">{agent.envVar}</span>
        </div>
      </div>
    </div>
  );
}

export function BoundAgents({ agents }: { agents: BoundAgentVM[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-fg-3 mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
          Bound agents · structural value
        </div>
        <div className="flex flex-col gap-2">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>

      <div className="border-border bg-bg-sunken rounded-md border border-dashed px-3 py-3">
        <div className="text-fg-3 mb-2 text-[10.5px] font-semibold tracking-wider uppercase">
          Injected env (from .mosoo.toml)
        </div>
        <div className="flex flex-col gap-1.5">
          {agents.map((agent) => (
            <div key={agent.id} className="flex items-center gap-2">
              <code className="text-fg-1 font-mono text-[12.5px]">{agent.envVar}</code>
              <span className="text-fg-3 select-none">=</span>
              {agent.threadUrl === null ? (
                <span className="text-fg-3 min-w-0 truncate text-[12px] italic">
                  self-authorizing URL · minted at deploy
                </span>
              ) : (
                <code className="text-fg-3 min-w-0 truncate font-mono text-[12px]">
                  {agent.threadUrl}
                </code>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-secondary rounded-md px-3 py-2.5">
        <div className="text-fg-3 mb-1 text-[10.5px] font-semibold tracking-wider uppercase">
          Console actions
        </div>
        <p className="text-fg-2 text-[12.5px] leading-relaxed">
          <span className="text-fg-1 font-semibold">Retry</span> re-pulls the default branch HEAD and
          redeploys · <span className="text-fg-1 font-semibold">Delete</span> removes the App, Worker,
          and bindings.
        </p>
      </div>
    </div>
  );
}
