import { ExternalLink } from "lucide-react";

import { IN_FLIGHT_STATUSES } from "@/domains/app/query/app-deployment-queries";
import { cn } from "@/shared/lib/class-names";

import type { DeploymentRunVM, DeploymentVM } from "../deploy-console-data";
import { hostOf, relativeLabel } from "../deploy-console-mapping";
import { useNowTick } from "../use-now-tick";

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

function PhaseStrip({ status }: { status: string }) {
  const activeIndex = DEPLOY_PHASES.findIndex((phase) =>
    (phase.statuses as readonly string[]).includes(status),
  );

  return (
    <div aria-label="Deploy progress" className="flex items-center gap-0.5">
      {DEPLOY_PHASES.map((phase, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <span key={phase.label} className="flex items-center gap-0.5">
            {index > 0 ? (
              <span
                aria-hidden
                className={cn("h-px w-3", done || active ? "bg-amber-fg/50" : "bg-border")}
              />
            ) : null}
            <span
              className={cn(
                "text-[12px] font-medium",
                done && "text-fg-2",
                active && "text-amber-fg animate-pulse font-semibold",
                !done && !active && "text-fg-3/60",
              )}
            >
              {done ? "✓ " : ""}
              {phase.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function DomainLink({ liveUrl, large }: { liveUrl: string; large?: boolean }) {
  return (
    <a
      href={liveUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "text-fg-1 hover:text-accent-press inline-flex min-w-0 items-center gap-1.5 font-semibold transition-colors hover:underline",
        large ? "text-[15px]" : "text-[13.5px]",
      )}
    >
      <span className="truncate">{hostOf(liveUrl)}</span>
      <ExternalLink className="text-fg-3 size-3.5 shrink-0" />
    </a>
  );
}

function ErrorNotice({ run }: { run: DeploymentRunVM }) {
  return (
    <div className="bg-destructive/6 rounded-lg px-3.5 py-2.5">
      <span className="text-destructive font-mono text-[12px] font-semibold">
        {run.errorCode ?? "deploy_failed"}
      </span>
      {run.errorMessage === null ? null : (
        <p className="text-fg-2 mt-1 text-[13px] leading-relaxed">{run.errorMessage}</p>
      )}
    </div>
  );
}

/**
 * The Domain group of the deployed hero — unboxed label/value typography, no
 * card chrome. Live: the domain link plus run meta. Deploying: the phase
 * strip. Failed: the error notice, with the still-serving domain when a prior
 * success exists. Never shows a URL before the first successful deploy.
 */
export function DeployUrlCard({
  deployment,
  latestRun,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
}) {
  const now = useNowTick();
  const inFlight =
    latestRun !== undefined &&
    latestRun.status !== "superseded" &&
    IN_FLIGHT_STATUSES.has(latestRun.status);
  const failed = latestRun !== undefined && latestRun.status === "failed";

  return (
    <div className="flex flex-col gap-2">
      <div className="text-fg-3 text-[13px]">Domain</div>

      {inFlight && latestRun !== undefined ? (
        <div className="flex flex-col gap-2.5">
          <PhaseStrip status={latestRun.status} />
          {deployment.liveUrl === null ? null : (
            <div className="text-fg-3 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px]">
              <span>Serving last successful deploy</span>
              <DomainLink liveUrl={deployment.liveUrl} />
            </div>
          )}
        </div>
      ) : failed && latestRun !== undefined ? (
        <div className="flex flex-col gap-2.5">
          <ErrorNotice run={latestRun} />
          {deployment.liveUrl === null ? null : (
            <div className="flex min-w-0 flex-col gap-1">
              <DomainLink liveUrl={deployment.liveUrl} />
              <p className="text-fg-3 text-[13px]">
                Your live site is unaffected — this domain still serves the last successful deploy.
              </p>
            </div>
          )}
        </div>
      ) : deployment.liveUrl !== null ? (
        <div className="flex flex-col gap-1">
          <DomainLink liveUrl={deployment.liveUrl} large />
          {latestRun === undefined ? null : (
            <div className="text-fg-3 text-[13px]">
              {latestRun.number === null ? null : <>Deploy #{latestRun.number} · </>}
              <span className="font-mono">{latestRun.commitSha}</span> ·{" "}
              {relativeLabel(latestRun.createdAt, now)}
            </div>
          )}
        </div>
      ) : (
        <p className="text-fg-3 text-[13px]">
          No live URL yet — it appears after the first successful deploy.
        </p>
      )}
    </div>
  );
}
