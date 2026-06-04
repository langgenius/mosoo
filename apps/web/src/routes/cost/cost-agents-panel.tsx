import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";

import {
  agentCostChange,
  cacheHitRate,
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  formatPlainPercent,
  runMixSegments,
  sortCostAgents,
  tokensTotal,
} from "./cost-model";
import type { AgentCostSort, CostAgentRow } from "./cost-model";

const SORT_OPTIONS: { label: string; value: AgentCostSort }[] = [
  { label: "Cost desc", value: "cost_desc" },
  { label: "Cost asc", value: "cost_asc" },
  { label: "Runs", value: "runs_desc" },
  { label: "Biggest spike", value: "spike_desc" },
];

export function CostAgentsPanel({
  agents,
  setSort,
  sort,
}: {
  agents: CostAgentRow[];
  setSort: (value: AgentCostSort) => void;
  sort: AgentCostSort;
}) {
  const sortedAgents = sortCostAgents(agents, sort);

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">By Agent</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">Owner, run mix, and spend trend</p>
        </div>
        <label className="text-muted-foreground flex items-center gap-2 text-xs font-semibold">
          Sort
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as AgentCostSort);
            }}
            className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="border-border bg-muted/30 text-muted-foreground grid grid-cols-[minmax(180px,1.4fr)_150px_110px_110px_110px_110px_110px_120px] border-b px-4 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
        <div>Agent</div>
        <div>Owner</div>
        <div>Run mix</div>
        <div>vs. Prev</div>
        <div>Requests</div>
        <div>Tokens</div>
        <div>Cache hit</div>
        <div className="text-right">Cost</div>
      </div>
      {agents.length === 0 ? (
        <div className="text-muted-foreground px-4 py-10 text-center text-sm">
          No agent cost events in this range.
        </div>
      ) : null}
      {sortedAgents.map((agent) => (
        <Link
          key={agent.agentId}
          to={`/agent/${agent.agentId}?tab=cost`}
          className="border-border hover:bg-muted/40 grid grid-cols-[minmax(180px,1.4fr)_150px_110px_110px_110px_110px_110px_120px] items-center border-b px-4 py-3 text-sm last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-foreground truncate font-semibold">{agent.agentName}</div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
              <ExternalLink className="size-3" />
              Open cost tab
            </div>
          </div>
          <div className="text-muted-foreground min-w-0">
            <div className="truncate">{agent.ownerName}</div>
            <div className="truncate text-xs">{agent.ownerEmail}</div>
          </div>
          <RunMixBar agent={agent} />
          <AgentDelta agent={agent} />
          <div>{formatCompactNumber(agent.requestCount)}</div>
          <div>{formatCompactNumber(tokensTotal(agent))}</div>
          <div>{formatPlainPercent(cacheHitRate(agent))}</div>
          <div className="text-right">
            <div className="font-mono font-semibold">{formatCurrency(agent.totalCostUsd)}</div>
            <div className="text-muted-foreground text-xs">
              {formatPlainPercent(agentShare(agent, agents))}
            </div>
          </div>
        </Link>
      ))}
    </section>
  );
}

function AgentDelta({ agent }: { agent: CostAgentRow }) {
  const delta = agentCostChange(agent);

  if (delta === null) {
    return <div className="text-muted-foreground text-xs">New</div>;
  }

  return (
    <div className={cn("font-mono text-xs", delta > 0 ? "text-amber-fg" : "text-success-fg")}>
      {formatPercent(delta)}
    </div>
  );
}

function agentShare(agent: CostAgentRow, agents: CostAgentRow[]): number {
  const total = agents.reduce((sum, row) => sum + row.totalCostUsd, 0);
  return total > 0 ? agent.totalCostUsd / total : 0;
}

export function RunMixBar({ agent }: { agent: CostAgentRow }) {
  const total = agent.totalCostUsd;
  const parts = runMixSegments(agent);

  if (total <= 0 || parts.length === 0) {
    return <div className="bg-muted h-2 rounded-full" />;
  }

  return (
    <div className="bg-muted flex h-2 overflow-hidden rounded-full">
      {parts.map((part) => (
        <span
          key={part.label}
          className={part.className}
          style={{ width: `${Math.max(4, (part.value / total) * 100)}%` }}
        />
      ))}
    </div>
  );
}
