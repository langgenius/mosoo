import { Bot, Moon } from "lucide-react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";

import { Badge } from "@/shared/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import type { AgentInstanceFixture, AgentInstanceLifecycle } from "../agent-instance-data";
import { appNamespaceAgentPath } from "../deploy-console-mapping";

/** Formats a numeric spend as a compact USD string, e.g. 0.5 → "$0.50". */
function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * The compact lifecycle pill for a dashboard row: awake reads as a pulsing
 * "Live", asleep as a Moon "Idle". The non-color icon cue survives
 * colorblindness; the longer "sleeps when quiet" copy lives on the detail page.
 */
function AgentStatusBadge({ lifecycle }: { lifecycle: AgentInstanceLifecycle }): ReactElement {
  if (lifecycle === "idle") {
    return (
      <Badge variant="default">
        <Moon aria-hidden />
        Idle
      </Badge>
    );
  }

  return (
    <Badge variant="success">
      <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      Live
    </Badge>
  );
}

/** One stat tile: a small muted label over a big mono number. */
function StatTile({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="border-border bg-background rounded-lg border px-5 py-4">
      <span className="text-fg-3 block text-[12px]">{label}</span>
      <span className="text-fg-1 mt-2 block font-mono text-[26px] leading-none font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

/** The uppercase small-caps column head shared by every dashboard column. */
function ColumnHead({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactElement {
  return (
    <TableHead
      className={`text-fg-3 h-10 text-[11px] font-semibold tracking-wider uppercase ${className ?? ""}`}
    >
      {children}
    </TableHead>
  );
}

/**
 * The AGENT LIST dashboard: a page title, four stat tiles reading "how many are
 * live, how busy, how much, how many deployed", and a table of every deployed
 * agent (name · Live/Idle status · version · name-addressed endpoint · last
 * active). A row is the way into that agent's detail page — clicking (or
 * Enter/Space on) a row selects it. Pure presentation over the
 * {@link AgentInstanceFixture} list; the preview route owns the selection state.
 */
export function AgentDashboard({
  agents,
  onSelect,
  headerActions,
  headerBadges,
}: {
  agents: AgentInstanceFixture[];
  /** Selects an agent by id — the route swaps in its detail page. */
  onSelect: (agentId: string) => void;
  /** Right-aligned header extras (the preview's scenario switcher). */
  headerActions?: ReactNode;
  /** Extra badges next to the title (e.g. the preview's "Demo data"). */
  headerBadges?: ReactNode;
}): ReactElement {
  const liveCount = agents.filter((agent) => agent.lifecycle === "live").length;
  const sessionsToday = agents.reduce((sum, agent) => sum + agent.sessionsToday, 0);
  const spendToday = agents.reduce((sum, agent) => sum + agent.todaySpend, 0);

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, agentId: string): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(agentId);
    }
  }

  return (
    <div data-testid="agent-dashboard" className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 flex-col items-start justify-between gap-4 border-b px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:px-8">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold tracking-normal">
              Agents
            </h1>
            {headerBadges}
          </div>
          <p className="text-fg-3 mt-1 text-[13px]">
            Deployed agents on this app, addressable by name.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">{headerActions}</div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Live agents" value={String(liveCount)} />
            <StatTile label="Sessions today" value={String(sessionsToday)} />
            <StatTile label="Spend today" value={formatUsd(spendToday)} />
            <StatTile label="Deployed agents" value={String(agents.length)} />
          </div>

          <div className="border-border bg-background overflow-hidden rounded-xl border">
            <div className="border-border flex items-center justify-between border-b px-5 py-3.5">
              <h2 className="text-fg-1 text-[14px] font-semibold">All agents</h2>
              <span className="text-fg-3 text-[12.5px]">{String(agents.length)} deployed</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <ColumnHead className="pl-5">Agent</ColumnHead>
                  <ColumnHead>Status</ColumnHead>
                  <ColumnHead>Version</ColumnHead>
                  <ColumnHead>Endpoint</ColumnHead>
                  <ColumnHead className="pr-5">Last active</ColumnHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <TableRow
                    key={agent.id}
                    data-testid="agent-dashboard-row"
                    // A table row cannot be a native <button>; it stays a
                    // keyboard-accessible clickable row (tabIndex + Enter/Space).
                    // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${agent.name}`}
                    onClick={() => {
                      onSelect(agent.id);
                    }}
                    onKeyDown={(event) => {
                      onRowKeyDown(event, agent.id);
                    }}
                    className="focus-visible:ring-ring cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    <TableCell className="py-4 pl-5">
                      <div className="flex items-center gap-2.5">
                        <span className="bg-bg-sunken text-fg-3 flex size-8 shrink-0 items-center justify-center rounded-full">
                          <Bot className="size-4" />
                        </span>
                        <span className="text-fg-1 text-[13.5px] font-semibold">{agent.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="py-4 align-middle">
                      <AgentStatusBadge lifecycle={agent.lifecycle} />
                    </TableCell>
                    <TableCell className="text-fg-2 py-4 align-middle font-mono text-[12.5px]">
                      v{String(agent.liveVersion)}
                    </TableCell>
                    <TableCell className="py-4 align-middle">
                      <code className="text-fg-3 block max-w-[240px] truncate font-mono text-[12px]">
                        {appNamespaceAgentPath(agent.slug, agent.name)}
                      </code>
                    </TableCell>
                    <TableCell className="text-fg-3 py-4 pr-5 align-middle font-mono text-[12.5px]">
                      {agent.lastActive}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>
    </div>
  );
}
