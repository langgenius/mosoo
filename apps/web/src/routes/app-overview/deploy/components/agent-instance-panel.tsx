import {
  ArrowLeft,
  ArrowUpRight,
  Braces,
  Check,
  Code2,
  Copy,
  GitBranch,
  Globe,
  KeyRound,
  Moon,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";

import type {
  AgentInstanceCheckpoint,
  AgentInstanceFixture,
  AgentInstanceLifecycle,
} from "../agent-instance-data";
import { stripProtocol } from "../deploy-console-mapping";
import { ActivitySection } from "./deployments-history";

/** Anchor ids the header op cluster scrolls to. */
const ADDRESS_ANCHOR = "agent-instance-address";
const ACTIVITY_ANCHOR = "agent-instance-activity";

/** Smooth-scroll a section into view; a no-op where the DOM lacks scrollIntoView. */
function scrollToAnchor(id: string): void {
  document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

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

/** A single-line mono command with an inline copy — the "shell into it" affordance. */
function CopyRow({ command, label }: { command: string; label: string }): ReactElement {
  return (
    <div className="border-border bg-bg-sunken/60 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3">
      <code className="text-fg-2 min-w-0 flex-1 truncate font-mono text-[11.5px]">{command}</code>
      <CopyButton label={label} text={command} />
    </div>
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

/**
 * The header lifecycle chip: awake reads as a pulsing "Live", asleep as a Moon
 * "Idle · sleeps when quiet" — a real hibernate/wake state, not a static badge.
 * The non-color icon cue (pulse dot / Moon) survives colorblindness.
 */
function LifecycleBadge({ lifecycle }: { lifecycle: AgentInstanceLifecycle }): ReactElement {
  if (lifecycle === "idle") {
    return (
      <Badge variant="default">
        <Moon aria-hidden />
        Idle · sleeps when quiet
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

/** One meter tile: muted label + big mono value + optional hint (or a chart slot). */
function MeterTile({
  label,
  value,
  hint,
  chart,
}: {
  label: string;
  value: string;
  hint?: string;
  chart?: ReactNode;
}): ReactElement {
  return (
    <div className="border-border bg-background rounded-lg border px-5 py-4">
      <span className="text-fg-3 block text-[12px]">{label}</span>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-fg-1 block font-mono text-[22px] leading-none font-semibold tabular-nums">
          {value}
        </span>
        {chart}
      </div>
      {hint === undefined ? null : <span className="text-fg-3 mt-2 block text-[12px]">{hint}</span>}
    </div>
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

/**
 * The meter strip under the Address spine: three tiles reading "is it live, is
 * it cheap" at a glance — sessions today, spend (with the "$0 while idle"
 * economics and the light sparkline), and either the live version or the
 * cold-wake time.
 */
function MeterStrip({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  const awake = fixture.lifecycle === "live";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MeterTile label="Sessions today" value={String(fixture.sessionsToday)} />
      <MeterTile
        label="Spent today"
        value={fixture.todayCost}
        hint="$0 while idle"
        chart={<Sparkline points={fixture.costTrend} />}
      />
      {awake ? (
        <MeterTile
          label="Live version"
          value={`v${String(fixture.liveVersion)}`}
          hint="sleeps when idle"
        />
      ) : (
        <MeterTile label="Wakes in" value={fixture.wakesIn} hint="state preserved" />
      )}
    </div>
  );
}

/**
 * BLOCK "Address" — THE SPINE: the code-first door. The name-addressed
 * create-thread endpoint, a one-line "shell into it" command, a ready-to-run
 * curl with a PAT bearer, a token pointer, and the App OpenAPI URL. Reuses the
 * live Connect card's typographic language and anchors the whole detail page.
 */
function AddressBlock({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  const { endpoint } = fixture;

  return (
    <section
      id={ADDRESS_ANCHOR}
      data-testid="agent-instance-address"
      className="border-border bg-background flex scroll-mt-4 flex-col gap-3.5 rounded-xl border px-5 py-4"
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

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-fg-3 text-[12px]">Shell into it</span>
        <CopyRow command={endpoint.shellCommand} label="Copy shell command" />
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

/**
 * BLOCK "Exposed surfaces" — what callers can reach. The API is always on; the
 * web frontend is a single optional attachment, reinforcing "web is an
 * attachment, not the identity." Zero or one exposed frontend.
 */
function ExposedSurfacesBlock({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  const { exposed } = fixture;

  return (
    <section
      data-testid="agent-instance-exposed"
      className="border-border bg-background flex flex-col gap-3 rounded-xl border px-5 py-4"
    >
      <BlockHeader icon={Globe} title="Exposed surfaces" subtitle="What callers can reach" />

      <div className="flex items-center gap-2">
        <span className="text-fg-3 w-14 shrink-0 font-mono text-[12px]">api</span>
        <a
          href={exposed.apiUrl}
          target="_blank"
          rel="noreferrer"
          className="text-fg-2 min-w-0 flex-1 truncate font-mono text-[12px] hover:underline"
        >
          {stripProtocol(exposed.apiUrl)}
        </a>
        <CopyButton label="Copy API URL" text={exposed.apiUrl} />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-fg-3 w-14 shrink-0 font-mono text-[12px]">web</span>
        {exposed.webUrl === null ? (
          <>
            <span className="text-fg-3 min-w-0 flex-1 truncate text-[12.5px]">
              No frontend attached
            </span>
            <Button type="button" variant="tonal" size="xs">
              Attach one
            </Button>
          </>
        ) : (
          <>
            <a
              href={exposed.webUrl}
              target="_blank"
              rel="noreferrer"
              className="text-fg-2 min-w-0 flex-1 truncate font-mono text-[12px] hover:underline"
            >
              {stripProtocol(exposed.webUrl)}
            </a>
            <Button
              type="button"
              variant="tonal"
              size="xs"
              render={
                <a
                  href={exposed.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open web frontend"
                />
              }
            >
              Open
              <ArrowUpRight className="size-3" />
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The consequence-stating confirm dialog for a rollback: it names what happens
 * (live becomes the picked version, in-flight sessions finish on the current
 * one) and that it is reversible, in plain words — mounted only while open.
 */
function RestoreDialog({
  checkpoint,
  liveVersion,
  onClose,
}: {
  checkpoint: AgentInstanceCheckpoint | null;
  liveVersion: number;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      open={checkpoint !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {checkpoint === null ? null : (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Roll back to v{String(checkpoint.version)}?</DialogTitle>
            <DialogDescription>
              Live becomes v{String(checkpoint.version)}; in-flight sessions finish on v
              {String(liveVersion)}. Reversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="default" onClick={onClose}>
              Roll back
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * BLOCK "Checkpoints" — versions as fork/restore points: the live version leads
 * with a green dot, older ones each carry a Restore that opens a
 * consequence-stating confirm. A version history you can roll back to.
 */
function CheckpointsBlock({ fixture }: { fixture: AgentInstanceFixture }): ReactElement {
  const [restoring, setRestoring] = useState<AgentInstanceCheckpoint | null>(null);

  return (
    <section
      data-testid="agent-instance-checkpoints"
      className="border-border bg-background flex flex-col gap-3 rounded-xl border px-5 py-4"
    >
      <BlockHeader icon={GitBranch} title="Checkpoints" subtitle="Roll back any time" />

      <ul className="flex flex-col gap-1.5">
        {fixture.checkpoints.slice(0, 3).map((checkpoint) => (
          <li key={checkpoint.id} className="flex items-center gap-2 text-[12.5px]">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                checkpoint.live ? "bg-success-fg" : "bg-fg-muted",
              )}
              aria-hidden
            />
            <code className="text-fg-2 shrink-0 font-mono text-[12px]">
              v{String(checkpoint.version)}
              {checkpoint.live ? " · live" : ""}
            </code>
            <span className="text-fg-3 min-w-0 flex-1 truncate font-mono text-[11.5px]">
              {checkpoint.when}
            </span>
            {checkpoint.live ? null : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setRestoring(checkpoint);
                }}
              >
                Restore
              </Button>
            )}
          </li>
        ))}
      </ul>

      <RestoreDialog
        checkpoint={restoring}
        liveVersion={fixture.liveVersion}
        onClose={() => {
          setRestoring(null);
        }}
      />
    </section>
  );
}

/**
 * The per-agent DETAIL page, reached from the {@link AgentDashboard} list: a
 * published, non-web agent reframed as a persistent compute instance you own.
 * The spine is the ADDRESS (its code-first door); under it a light meter strip
 * (sessions · spend · live-version/wake) and then the ACTIVITY log — the SAME
 * `ActivitySection` the web console renders, fed this agent's deployment-run
 * rows — beside a rail of secondary blocks: Exposed surfaces (web is a 0-or-1
 * attachment) and Checkpoints (roll back any time). There is no chat console.
 *
 * Pure presentation over a single {@link AgentInstanceFixture}; the rollback
 * confirm resolves in local state only (no backend seam), so this renders
 * standalone in the `/v0-deploy-preview` design prototype. Header slots let the
 * preview route keep its scenario switcher and demo badge visible.
 */
export function AgentInstancePanel({
  fixture,
  onBack,
  headerActions,
  headerBadges,
}: {
  fixture: AgentInstanceFixture;
  /** Returns to the agent-list dashboard. */
  onBack: () => void;
  /** Right-aligned header extras (the preview's scenario switcher). */
  headerActions?: ReactNode;
  /** Extra badges next to the agent name (e.g. the preview's "Demo data"). */
  headerBadges?: ReactNode;
}): ReactElement {
  return (
    <div data-testid="agent-instance-panel" className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 flex-col items-start justify-between gap-4 border-b px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:px-8">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="text-fg-3 hover:text-fg-1 inline-flex items-center gap-1 text-[12.5px] font-medium transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Agents
          </button>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-foreground min-w-0 truncate text-2xl font-semibold tracking-normal">
              {fixture.name}
            </h1>
            <LifecycleBadge lifecycle={fixture.lifecycle} />
            <span className="text-fg-3 font-mono text-[13px]">v{String(fixture.liveVersion)}</span>
            {headerBadges}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              scrollToAnchor(ACTIVITY_ANCHOR);
            }}
          >
            <ScrollText className="size-3.5" />
            Activity
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              scrollToAnchor(ADDRESS_ANCHOR);
            }}
          >
            <Code2 className="size-3.5" />
            API
          </Button>
          {headerActions}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <AddressBlock fixture={fixture} />

          <MeterStrip fixture={fixture} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
            <section id={ACTIVITY_ANCHOR} className="scroll-mt-4">
              <ActivitySection runs={fixture.runs} />
            </section>
            <div className="flex flex-col gap-6">
              <ExposedSurfacesBlock fixture={fixture} />
              <CheckpointsBlock fixture={fixture} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
