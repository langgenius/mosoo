import { ExternalLink } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";

import type { DeploymentRunVM, DeploymentVM } from "../deploy-console-data";

/**
 * The 8 backend run statuses collapsed into the 5 phases a user actually
 * watches: Queued → Build → Submit → Activate → Live.
 */
const DEPLOY_PHASES = [
  { label: "Queued", statuses: ["queued"] },
  { label: "Build", statuses: ["preparing", "building"] },
  { label: "Submit", statuses: ["submitting", "submitted"] },
  { label: "Activate", statuses: ["activating"] },
  { label: "Live", statuses: ["success"] },
] as const;

const IN_FLIGHT: ReadonlySet<string> = new Set([
  "queued",
  "preparing",
  "building",
  "submitting",
  "submitted",
  "activating",
]);

function PhaseStrip({ status }: { status: string }) {
  const activeIndex = DEPLOY_PHASES.findIndex((phase) =>
    (phase.statuses as readonly string[]).includes(status),
  );

  return (
    <div aria-label="Deploy progress" className="flex items-center gap-1">
      {DEPLOY_PHASES.map((phase, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <span
            key={phase.label}
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
              done && "bg-success-bg text-success-fg",
              active && "bg-amber-bg text-amber-fg animate-pulse",
              !done && !active && "bg-bg-sunken text-fg-3",
            )}
          >
            {phase.label}
          </span>
        );
      })}
    </div>
  );
}

function LiveUrlLink({ liveUrl, host }: { liveUrl: string; host: string }) {
  return (
    <a
      href={liveUrl}
      target="_blank"
      rel="noreferrer"
      className="text-accent-press inline-flex min-w-0 items-center gap-1 font-mono text-[13px] hover:underline"
    >
      <span className="truncate">{host}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

/**
 * The URL card: the live URL when a run is serving, the current phase while a
 * deploy settles, and the error surface when the latest run failed. Shows no
 * URL at all unless a successful deploy is (still) serving.
 */
export function DeployUrlCard({
  deployment,
  latestRun,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
}) {
  const inFlight = latestRun !== undefined && IN_FLIGHT.has(latestRun.status);
  const failed = latestRun?.status === "failed";

  return (
    <div className="border-border bg-background rounded-lg border px-4 py-3.5">
      <div className="text-fg-3 mb-2 text-[10.5px] font-semibold tracking-wider uppercase">URL</div>

      {inFlight && latestRun !== undefined ? (
        <div className="flex flex-col gap-2">
          <PhaseStrip status={latestRun.status} />
          {deployment.liveUrl !== null && deployment.subdomain !== null ? (
            <div className="text-fg-3 flex min-w-0 items-center gap-1.5 text-[12.5px]">
              <span>Serving last successful deploy:</span>
              <LiveUrlLink liveUrl={deployment.liveUrl} host={deployment.subdomain} />
            </div>
          ) : null}
        </div>
      ) : failed && latestRun !== undefined ? (
        <div className="flex flex-col gap-2">
          <div className="bg-destructive/8 rounded-md px-3 py-2">
            <div className="text-destructive font-mono text-[12px] font-semibold">
              {latestRun.errorCode ?? "deploy_failed"}
            </div>
            {latestRun.errorMessage === null ? null : (
              <p className="text-fg-2 mt-0.5 text-[12.5px] leading-relaxed">
                {latestRun.errorMessage}
              </p>
            )}
          </div>
          {deployment.liveUrl !== null && deployment.subdomain !== null ? (
            <div className="flex min-w-0 flex-col gap-1">
              <LiveUrlLink liveUrl={deployment.liveUrl} host={deployment.subdomain} />
              <p className="text-fg-3 text-[12.5px]">
                Your live site is unaffected — the URL still serves the last successful deploy.
              </p>
            </div>
          ) : null}
        </div>
      ) : deployment.liveUrl !== null && deployment.subdomain !== null ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <LiveUrlLink liveUrl={deployment.liveUrl} host={deployment.subdomain} />
            <Badge variant="success">live</Badge>
          </div>
          {latestRun === undefined ? null : (
            <div className="text-fg-3 text-[12.5px]">
              #{latestRun.number} · commit <span className="font-mono">{latestRun.commitSha}</span>{" "}
              · {latestRun.createdLabel}
            </div>
          )}
        </div>
      ) : (
        <p className="text-fg-3 text-[12.5px]">
          No live URL yet — it appears after the first successful deploy.
        </p>
      )}
    </div>
  );
}
