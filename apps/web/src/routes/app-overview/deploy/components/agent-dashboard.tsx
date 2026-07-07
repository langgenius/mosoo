import { ArrowUpRight, Bot, Check, ChevronDown, Copy, Globe, KeyRound, Moon } from "lucide-react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type {
  AgentInstanceFixture,
  AgentInstanceLifecycle,
  AgentInstanceType,
} from "../agent-instance-data";

/** A small copy button — the only copy affordance on the address card. */
function CopyButton({ label, text }: { label: string; text: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      className="gap-1 text-[11.5px]"
      aria-label={label}
      onClick={() => {
        if (!navigator.clipboard) {
          return;
        }
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          globalThis.setTimeout(() => {
            setCopied(false);
          }, 1500);
        });
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** The two-value type tag: an API-addressed "Agent" or an attached "Web" surface. */
function TypeTag({ type }: { type: AgentInstanceType }): ReactElement {
  if (type === "web") {
    return (
      <Badge variant="outline">
        <Globe aria-hidden />
        Web
      </Badge>
    );
  }

  return (
    <Badge variant="outline">
      <Bot aria-hidden />
      Agent
    </Badge>
  );
}

/**
 * The lifecycle pill: awake reads as a pulsing "Live", asleep as a Moon "Idle".
 * The non-color icon cue survives colorblindness.
 */
function StatusBadge({ lifecycle }: { lifecycle: AgentInstanceLifecycle }): ReactElement {
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

/**
 * The MINIMAL address card shown inline when a row expands — a developer wants
 * one unique endpoint and one working curl, nothing else. An `agent` shows its
 * create-thread endpoint (one copy), a ready-to-run curl (one copy), and a
 * one-line token hint whose token phrase is a link (no copy). A `web` shows just
 * its live URL and an Open link — no curl.
 */
function AgentAddressCard({ agent }: { agent: AgentInstanceFixture }): ReactElement {
  if (agent.type === "web") {
    const url = agent.url ?? "";

    return (
      <div
        data-testid="agent-address-card"
        className="border-border bg-bg-sunken/40 flex flex-col gap-2 rounded-lg border px-4 py-3.5"
      >
        <span className="text-fg-3 text-[12px]">Live URL</span>
        <div className="flex min-w-0 items-center gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-fg-2 min-w-0 flex-1 truncate font-mono text-[12px] hover:underline"
          >
            {url}
          </a>
          <Button
            type="button"
            variant="tonal"
            size="xs"
            render={
              <a href={url} target="_blank" rel="noreferrer" aria-label="Open web frontend" />
            }
          >
            Open
            <ArrowUpRight className="size-3" />
          </Button>
        </div>
      </div>
    );
  }

  const { endpoint } = agent;
  if (endpoint === undefined) {
    return <></>;
  }

  return (
    <div
      data-testid="agent-address-card"
      className="border-border bg-bg-sunken/40 flex flex-col gap-3 rounded-lg border px-4 py-3.5"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-fg-3 text-[12px]">Endpoint</span>
        <div className="flex min-w-0 items-center gap-2">
          <code className="text-fg-2 min-w-0 flex-1 truncate font-mono text-[12px]">
            {endpoint.threadsPath}
          </code>
          <CopyButton label="Copy endpoint" text={endpoint.threadsPath} />
        </div>
      </div>

      <div className="border-border bg-background relative rounded-lg border">
        <pre className="text-fg-2 overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
          <code>{endpoint.curl}</code>
        </pre>
        <div className="absolute top-1.5 right-1.5">
          <CopyButton label="Copy curl" text={endpoint.curl} />
        </div>
      </div>

      <p className="text-fg-3 flex items-center gap-1.5 text-[12.5px]">
        <KeyRound className="size-3.5 shrink-0" />
        <span>
          Authenticate with a{" "}
          <Link
            to={endpoint.tokenSettingsPath}
            className="text-accent-press font-medium hover:underline"
          >
            personal access token
          </Link>
          .
        </span>
      </p>
    </div>
  );
}

/**
 * The AGENT LIST for the "instance" scenario: a title, then one row per deployed
 * agent (name · type tag · Live/Idle · version). Clicking a row expands it in
 * place (accordion) to reveal that agent's {@link AgentAddressCard} — there is
 * no separate detail page. Below the list, the repo-level `activity` slot renders
 * the shared deployment feed once. Rows are native buttons, so Enter/Space toggle
 * them for free. Pure presentation over the {@link AgentInstanceFixture} list.
 */
export function AgentDashboard({
  agents,
  activity,
  headerActions,
  headerBadges,
}: {
  agents: AgentInstanceFixture[];
  /** Repo-level Production Activity, rendered once below the list. */
  activity?: ReactNode;
  /** Right-aligned header extras (the preview's scenario switcher). */
  headerActions?: ReactNode;
  /** Extra badges next to the title (e.g. the preview's "Demo data"). */
  headerBadges?: ReactNode;
}): ReactElement {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggle(id: string): void {
    setExpandedId((current) => (current === id ? null : id));
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
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <ul className="border-border bg-background divide-border divide-y overflow-hidden rounded-xl border">
            {agents.map((agent) => {
              const expanded = expandedId === agent.id;

              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    data-testid="agent-dashboard-row"
                    aria-expanded={expanded}
                    aria-label={`Toggle ${agent.name}`}
                    onClick={() => {
                      toggle(agent.id);
                    }}
                    className="focus-visible:ring-ring flex w-full items-center gap-2.5 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset sm:gap-3"
                  >
                    <span className="text-fg-1 min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {agent.name}
                    </span>
                    <TypeTag type={agent.type} />
                    <StatusBadge lifecycle={agent.lifecycle} />
                    <span className="text-fg-3 hidden font-mono text-[12.5px] sm:inline">
                      v{String(agent.version)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "text-fg-3 size-4 shrink-0 transition-transform",
                        expanded && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                  {expanded ? (
                    <div className="px-5 pb-4">
                      <AgentAddressCard agent={agent} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {activity === undefined ? null : (
            <section data-testid="instance-activity">{activity}</section>
          )}
        </div>
      </main>
    </div>
  );
}
