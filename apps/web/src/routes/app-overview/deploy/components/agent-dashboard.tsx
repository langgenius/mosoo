import { ArrowUpRight, Check, ChevronDown, Code2, Copy, Globe, KeyRound, Moon } from "lucide-react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type {
  AgentInstanceFixture,
  AgentInstanceLifecycle,
  AgentInstancePlane,
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

/**
 * The consumption-plane tag: `api` reads as a Code2 "API" (the endpoint/curl
 * plane), `web` as a Globe "Web" (the browser/url plane).
 */
function PlaneTag({ plane }: { plane: AgentInstancePlane }): ReactElement {
  if (plane === "web") {
    return (
      <Badge variant="outline">
        <Globe aria-hidden />
        Web
      </Badge>
    );
  }

  return (
    <Badge variant="outline">
      <Code2 aria-hidden />
      API
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
 * one unique endpoint and one working curl, nothing else. An `api`-plane agent
 * shows its create-thread Endpoint (one copy, the URL alone), an "Example
 * request" curl (one copy, the full runnable command), and a one-line token
 * hint whose token phrase is a link (no copy). A `web`-plane agent shows just
 * its live URL and an Open link — no curl.
 */
function AgentAddressCard({ agent }: { agent: AgentInstanceFixture }): ReactElement {
  if (agent.plane === "web") {
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
            <span className="text-fg-3">POST</span> {endpoint.url}
          </code>
          <CopyButton label="Copy endpoint" text={endpoint.url} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-fg-3 text-[12px]">Example request</span>
        <div className="border-border bg-background relative rounded-lg border">
          <pre className="text-fg-2 overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
            <code>{endpoint.curl}</code>
          </pre>
          <div className="absolute top-1.5 right-1.5">
            <CopyButton label="Copy example request" text={endpoint.curl} />
          </div>
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
 * The AGENT LIST for the "instance" scenario, rendered as a peer SECTION of
 * Production Activity so it reads as content inside the Overview — not its own
 * page. A modest "Agents" heading (mirroring the Activity section's heading
 * weight) sits above one row per deployed agent (name · plane tag · Live/Idle ·
 * version). Rows expand INDEPENDENTLY: any number can be open at once, each
 * revealing that agent's {@link AgentAddressCard} in place (no detail page).
 * Below the list, the repo-level `activity` slot renders the shared deployment
 * feed once. Rows are native buttons, so Enter/Space toggle them for free. The
 * whole body shares the web console's `max-w-5xl` container so its width and
 * vertical rhythm match the real deployed Overview.
 */
export function AgentDashboard({
  agents,
  activity,
  headerActions,
}: {
  agents: AgentInstanceFixture[];
  /** Repo-level Production Activity, rendered once below the list. */
  activity?: ReactNode;
  /** Right-aligned header extras (the preview's scenario switcher). */
  headerActions?: ReactNode;
}): ReactElement {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());

  function toggle(id: string): void {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div data-testid="agent-dashboard" className="flex h-full flex-col overflow-hidden">
      {headerActions === undefined ? null : (
        <header className="border-border bg-background flex shrink-0 items-center justify-end gap-2 border-b px-4 py-3 sm:px-6 lg:px-8">
          {headerActions}
        </header>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-14 pt-2">
          <section>
            <h2 className="text-fg-1 mb-4 text-[15px] font-semibold">Agents</h2>
            <ul className="border-border bg-background divide-border divide-y overflow-hidden rounded-xl border">
              {agents.map((agent) => {
                const expanded = expandedIds.has(agent.id);

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
                      <PlaneTag plane={agent.plane} />
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
          </section>

          {activity === undefined ? null : (
            <section data-testid="instance-activity">{activity}</section>
          )}
        </div>
      </main>
    </div>
  );
}
