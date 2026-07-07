import {
  Activity,
  ArrowUp,
  Bot,
  Braces,
  Check,
  Code2,
  Copy,
  Database,
  Globe,
  KeyRound,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Separator } from "@/shared/ui/separator";

import type {
  AgentInstanceFixture,
  AgentInstanceRecentSession,
  AgentInstanceToolCall,
} from "../agent-instance-data";

/** A resolved human decision on a pending tool call. */
type ToolDecision = "approved" | "rejected";

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

function CurlBlock({ curl, label }: { curl: string; label: string }): ReactElement {
  return (
    <div className="border-border bg-bg-sunken/60 relative rounded-lg border">
      <pre className="text-fg-2 overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed">
        <code>{curl}</code>
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton label={label} text={curl} />
      </div>
    </div>
  );
}

function BlockHeader({
  icon: Icon,
  title,
  subtitle,
  accessory,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  accessory?: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon className="text-fg-3 size-4 shrink-0" />
      <h2 className="text-fg-1 text-[14px] font-semibold">{title}</h2>
      <span className="text-fg-3 hidden text-[12.5px] sm:inline">{subtitle}</span>
      {accessory === undefined ? null : (
        <>
          <div className="flex-1" />
          {accessory}
        </>
      )}
    </div>
  );
}

/** "Running · v4 live", the header status pill — a live green dot on success tint. */
function StatusPill({ liveVersion }: { liveVersion: number }): ReactElement {
  return (
    <span className="bg-success-bg text-success-fg inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium">
      <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      Running · v{String(liveVersion)} live
    </span>
  );
}

/**
 * BLOCK 1 "Address" — the door for your code: the name-addressed create-thread
 * endpoint, a ready-to-run curl with a PAT bearer, a token pointer, and the App
 * OpenAPI URL. Reuses the live Connect card's typographic language.
 */
function AddressBlock({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  const { endpoint } = fixture;

  return (
    <section
      data-testid="agent-instance-address"
      className="border-border bg-background flex flex-col gap-3.5 rounded-xl border px-5 py-4"
    >
      <BlockHeader icon={Code2} title="Address" subtitle="The door for your code" />

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-fg-3 text-[12px]">Endpoint</span>
        <div className="flex min-w-0 items-center gap-2">
          <code className="text-fg-2 min-w-0 truncate font-mono text-[12px]">
            {endpoint.threadsPath}
          </code>
          <CopyButton label="Copy endpoint" text={endpoint.threadsPath} />
        </div>
      </div>

      <CurlBlock curl={endpoint.curl} label="Copy create-thread curl" />

      <div className="text-fg-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px]">
        <KeyRound className="size-3.5" />
        <span>Authenticate with a</span>
        <Link
          to={endpoint.tokenSettingsPath}
          className="text-accent-press font-medium hover:underline"
        >
          personal access token
        </Link>
        <span>· send it as a Bearer token.</span>
      </div>

      <Separator />

      <div className="flex min-w-0 items-center gap-2">
        <Braces className="text-fg-3 size-3.5 shrink-0" />
        <span className="text-fg-3 shrink-0 text-[12.5px]">OpenAPI</span>
        <code className="text-fg-2 min-w-0 flex-1 truncate font-mono text-[12px]">
          {endpoint.openapiUrl}
        </code>
        <CopyButton label="Copy OpenAPI URL" text={endpoint.openapiUrl} />
      </div>
    </section>
  );
}

/** Per-tool glyph so the feed reads like real calls; unknown tools fall to a wrench. */
function toolIcon(name: string): LucideIcon {
  if (name.startsWith("query_") || name.includes("_db")) {
    return Database;
  }
  if (name.startsWith("http_")) {
    return Globe;
  }
  return Wrench;
}

/**
 * One tool-call chip in the "watch it work" feed. A done chip shows a check + its
 * cost tick; a pending-approval chip carries the human-in-the-loop affordance —
 * Approve / Reject — and, once resolved, reads back the decision it recorded.
 */
function ToolCallChip({
  call,
  decision,
  onDecide,
}: {
  call: AgentInstanceToolCall;
  decision: ToolDecision | null;
  onDecide: (decision: ToolDecision) => void;
}): ReactElement {
  const Icon = toolIcon(call.name);
  const awaiting = call.status === "pending-approval" && decision === null;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        awaiting ? "border-amber-fg/30 bg-amber-bg/40" : "border-border bg-bg-sunken/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="text-fg-3 size-3.5 shrink-0" />
        <code className="text-fg-1 font-mono text-[12px]">{call.name}</code>
        <div className="flex-1" />
        <span className="text-fg-3 font-mono text-[11px]">{call.cost}</span>
        {call.status === "done" ? (
          <Check className="text-success-fg size-3.5" aria-label="ran" />
        ) : awaiting ? (
          <span
            className="bg-amber-fg size-1.5 animate-pulse rounded-full"
            aria-label="awaiting approval"
          />
        ) : null}
      </div>

      <p className="text-fg-3 mt-1 truncate pl-[22px] font-mono text-[11px]">{call.detail}</p>

      {awaiting ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[22px]">
          <span className="text-amber-fg text-[11.5px] font-medium">Needs your approval</span>
          <div className="flex-1" />
          <Button type="button" size="xs" variant="outline" onClick={() => onDecide("rejected")}>
            <X className="size-3" />
            Reject
          </Button>
          <Button type="button" size="xs" variant="accent" onClick={() => onDecide("approved")}>
            <Check className="size-3" />
            Approve
          </Button>
        </div>
      ) : null}

      {call.status === "pending-approval" && decision !== null ? (
        <p
          className={cn(
            "mt-1.5 pl-[22px] text-[11px] font-medium",
            decision === "approved" ? "text-success-fg" : "text-fg-3",
          )}
        >
          {decision === "approved" ? "Approved · ran" : "Rejected · skipped"}
        </p>
      ) : null}
    </div>
  );
}

/** A small round avatar for the agent's turn in the console. */
function AgentAvatar(): ReactElement {
  return (
    <span className="bg-accent-soft text-accent-press mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
      <Bot className="size-3.5" />
    </span>
  );
}

/**
 * BLOCK 2 "A way in" — THE CENTERPIECE: an embedded, live-feeling session where
 * you both talk to the agent and watch it work. The delegation, the tool-call
 * feed (one chip pending human approval), and the answer form one thread; a
 * composer footer conveys you can send the next delegation. Approvals resolve in
 * local state so intervening feels real without any session plumbing.
 */
function WayInBlock({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  const { messages, toolCalls } = fixture.session;
  const [decisions, setDecisions] = useState<Record<string, ToolDecision>>({});
  const [draft, setDraft] = useState("");

  const delegations = messages.filter((message) => message.role === "user");
  const answers = messages.filter((message) => message.role === "agent");

  return (
    <section
      data-testid="agent-instance-way-in"
      className="border-border bg-background flex h-full min-h-[440px] flex-col overflow-hidden rounded-xl border"
    >
      <div className="border-border/70 flex items-center gap-2 border-b px-5 py-3">
        <Terminal className="text-fg-3 size-4 shrink-0" />
        <h2 className="text-fg-1 text-[14px] font-semibold">A way in</h2>
        <span className="text-fg-3 hidden text-[12.5px] sm:inline">Talk to it · watch it work</span>
        <div className="flex-1" />
        <span className="text-success-fg inline-flex items-center gap-1.5 text-[11.5px] font-medium">
          <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
          live
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {delegations.map((message) => (
          <div key={message.id} className="flex flex-col items-end gap-1">
            <span className="text-fg-3 text-[11px]">You · delegated</span>
            <div className="bg-bg-sunken border-border text-fg-1 max-w-[85%] rounded-xl border px-3.5 py-2 text-[13px]">
              {message.text}
            </div>
          </div>
        ))}

        <div className="flex gap-2.5">
          <AgentAvatar />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <span className="text-fg-3 text-[11px]">{fixture.name} · working</span>
            <div className="flex flex-col gap-1.5">
              {toolCalls.map((call) => (
                <ToolCallChip
                  key={call.id}
                  call={call}
                  decision={decisions[call.id] ?? null}
                  onDecide={(decision) => {
                    setDecisions((prev) => ({ ...prev, [call.id]: decision }));
                  }}
                />
              ))}
            </div>
            {answers.map((message) => (
              <p key={message.id} className="text-fg-1 text-[13px] leading-relaxed">
                {message.text}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="border-border/70 border-t px-4 py-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Send a delegation…"
            aria-label="Send a delegation"
            className="border-border bg-bg-sunken/50 text-fg-1 placeholder:text-fg-muted focus-visible:border-ring h-9 min-w-0 flex-1 rounded-lg border px-3 text-[13px] outline-none"
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="default"
            aria-label="Send delegation"
            disabled={draft.trim() === ""}
          >
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </div>
    </section>
  );
}

/** A tiny bar sparkline of relative per-hour spend — the light "meter" touch. */
function Sparkline({ points }: { points: number[] }): ReactElement {
  const max = Math.max(...points, 1);

  return (
    <div className="flex h-8 items-end gap-0.5" aria-hidden>
      {points.map((value, index) => (
        <span
          key={index}
          className="bg-success-fg/40 w-1 rounded-full"
          style={{ height: `${String(Math.max(12, Math.round((value / max) * 100)))}%` }}
        />
      ))}
    </div>
  );
}

const RECENT_STATUS_DOT: Record<AgentInstanceRecentSession["status"], string> = {
  done: "bg-success-fg",
  failed: "bg-destructive",
  running: "bg-amber-fg animate-pulse",
};

function RecentSessionRow({ session }: { session: AgentInstanceRecentSession }): ReactElement {
  return (
    <li className="flex items-center gap-2 text-[12.5px]">
      <span
        className={cn("size-1.5 shrink-0 rounded-full", RECENT_STATUS_DOT[session.status])}
        aria-label={session.status}
      />
      <span className="text-fg-3 w-7 shrink-0 font-mono text-[11.5px]">{session.when}</span>
      <span className="text-fg-1 min-w-0 flex-1 truncate">{session.summary}</span>
      <span className="text-fg-3 shrink-0 font-mono text-[11.5px]">{session.cost}</span>
    </li>
  );
}

/**
 * BLOCK 3 "Pulse" — logs + meter: a few recent sessions (relative time · summary
 * · cost · status), the "N sessions today" count, today's spend, and a light
 * sparkline. Deliberately minimal — the centerpiece is Block 2.
 */
function PulseBlock({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  return (
    <section
      data-testid="agent-instance-pulse"
      className="border-border bg-background flex flex-col gap-3.5 rounded-xl border px-5 py-4"
    >
      <BlockHeader icon={Activity} title="Pulse" subtitle="Logs + meter" />

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-fg-1 text-[20px] leading-none font-semibold">
            {String(fixture.sessionsToday)}
          </span>
          <span className="text-fg-3 mt-1 text-[12px]">sessions today</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-fg-1 font-mono text-[15px] leading-none font-semibold">
            {fixture.todayCost}
          </span>
          <span className="text-fg-3 mt-1 text-[12px]">spent today</span>
        </div>
        <Sparkline points={fixture.costTrend} />
      </div>

      <Separator />

      <ul className="flex flex-col gap-2">
        {fixture.recentSessions.map((session) => (
          <RecentSessionRow key={session.id} session={session} />
        ))}
      </ul>
    </section>
  );
}

/** "Web is just an attachment" — a non-functional pointer, kept as a quiet footer. */
function AttachWebFooter(): ReactElement {
  return (
    <div className="text-fg-3 mt-8 flex items-center justify-center gap-1.5 text-[12.5px]">
      <span>No web frontend attached</span>
      <span aria-hidden>·</span>
      <button type="button" className="text-accent-press font-medium hover:underline">
        Attach one
      </button>
    </div>
  );
}

/**
 * The Overview for a published, NON-WEB agent, reframed as a remote stateful
 * compute instance: a header (name · Running·vN·live pill · today's cost), then
 * three blocks — Address (its API "IP"), A way in (the SSH-like session console,
 * the centerpiece), and Pulse (logs + meter) — closed by the "web is just an
 * attachment" footer. Pure presentation over a plain {@link AgentInstanceFixture};
 * approvals and the composer resolve in local state only (no backend seam), so
 * this renders standalone in the `/v0-deploy-preview` design prototype. Header
 * slots let the preview route keep its scenario switcher and demo badge visible.
 */
export function AgentInstancePanel({
  fixture,
  headerActions,
  headerBadges,
}: {
  fixture: AgentInstanceFixture;
  /** Right-aligned header extras (the preview's scenario switcher). */
  headerActions?: ReactNode;
  /** Extra badges next to the agent name (e.g. the preview's "Demo data"). */
  headerBadges?: ReactNode;
}): ReactElement {
  return (
    <div data-testid="agent-instance-panel" className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 flex-col items-start justify-between gap-4 border-b px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:px-8">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
            <Bot className="size-3.5" />
            Agent
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold tracking-normal">
              {fixture.name}
            </h1>
            <StatusPill liveVersion={fixture.liveVersion} />
            <span className="text-fg-3 font-mono text-[13px]">{fixture.todayCost} today</span>
            {headerBadges}
          </div>
        </div>
        {headerActions === undefined ? null : (
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">{headerActions}</div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
            <div className="order-2 lg:order-none lg:row-span-2">
              <WayInBlock fixture={fixture} />
            </div>
            <div className="order-1 lg:order-none">
              <AddressBlock fixture={fixture} />
            </div>
            <div className="order-3 lg:order-none">
              <PulseBlock fixture={fixture} />
            </div>
          </div>
          <AttachWebFooter />
        </div>
      </main>
    </div>
  );
}
