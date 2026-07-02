import { Bot } from "lucide-react";
import { Link } from "react-router-dom";

import type { BoundAgentVM } from "../deploy-console-data";

/**
 * Bound agents as an unboxed label + chip row: each chip links to the Agents
 * surface. Bindings come from `.mosoo.toml [[agents]]` and inject a
 * self-authorizing thread URL env var into the deployed Worker.
 */
export function BoundAgents({ agents }: { agents: BoundAgentVM[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-fg-3 text-[13px]">Bound agents</div>
      {agents.length === 0 ? (
        <p className="text-fg-3 text-[13px]">
          None yet — declare an <span className="text-fg-2 font-mono text-[12px]">[[agents]]</span>{" "}
          section in .mosoo.toml to inject thread URLs.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              to="/agent"
              className="border-border bg-background hover:border-accent group inline-flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1.5 transition-colors"
            >
              <span className="bg-accent-soft text-accent-press flex size-5 items-center justify-center rounded-full">
                <Bot className="size-3" />
              </span>
              <span className="text-fg-1 text-[13px] font-semibold">{agent.name}</span>
              <span className="text-fg-3 font-mono text-[11px]">{agent.envVar}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
