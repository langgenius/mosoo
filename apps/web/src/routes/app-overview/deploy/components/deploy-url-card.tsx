import { ExternalLink } from "lucide-react";

import { IN_FLIGHT_STATUSES } from "@/domains/app/query/app-deployment-queries";
import { Badge } from "@/shared/ui/badge";

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
    <div aria-label="Deploy progress" className="flex items-center gap-1">
      {DEPLOY_PHASES.map((phase, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <Badge
            key={phase.label}
            variant={done ? "success" : active ? "warning" : "default"}
            className={active ? "animate-pulse" : done ? undefined : "text-fg-3"}
          >
            {phase.label}
          </Badge>
        );
      })}
    </div>
  );
}

function LiveUrlLink({ liveUrl }: { liveUrl: string }) {
  return (
    <a
      href={liveUrl}
      target="_blank"
      rel="noreferrer"
      className="text-accent-press inline-flex min-w-0 items-center gap-1 font-mono text-[13px] hover:underline"
    >
      <span className="truncate">{hostOf(liveUrl)}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

function UrlCardBody({
  deployment,
  latestRun,
  now,
}: {
  deployment: DeploymentVM;
  latestRun: DeploymentRunVM | undefined;
  now: number;
}) {
  if (
    latestRun !== undefined &&
    latestRun.status !== "superseded" &&
    IN_FLIGHT_STATUSES.has(latestRun.status)
  ) {
    return (
      <div className="flex flex-col gap-2">
        <PhaseStrip status={latestRun.status} />
        {deployment.liveUrl === null ? null : (
          <div className="text-fg-3 flex min-w-0 items-center gap-1.5 text-[12.5px]">
            <span>Serving last successful deploy:</span>
            <LiveUrlLink liveUrl={deployment.liveUrl} />
          </div>
        )}
      </div>
    );
  }

  if (latestRun !== undefined && latestRun.status === "failed") {
    return (
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
        {deployment.liveUrl === null ? null : (
          <div className="flex min-w-0 flex-col gap-1">
            <LiveUrlLink liveUrl={deployment.liveUrl} />
            <p className="text-fg-3 text-[12.5px]">
              Your live site is unaffected — the URL still serves the last successful deploy.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (deployment.liveUrl !== null) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <LiveUrlLink liveUrl={deployment.liveUrl} />
          <Badge variant="success">live</Badge>
        </div>
        {latestRun === undefined ? null : (
          <div className="text-fg-3 text-[12.5px]">
            {latestRun.number === null ? null : <>#{latestRun.number} · </>}
            commit <span className="font-mono">{latestRun.commitSha}</span> ·{" "}
            {relativeLabel(latestRun.createdAt, now)}
          </div>
        )}
      </div>
    );
  }

  return (
    <p className="text-fg-3 text-[12.5px]">
      No live URL yet — it appears after the first successful deploy.
    </p>
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
  const now = useNowTick();

  return (
    <div className="border-border bg-background rounded-lg border px-4 py-3.5">
      <div className="text-fg-3 mb-2 text-[10.5px] font-semibold tracking-wider uppercase">URL</div>
      <UrlCardBody deployment={deployment} latestRun={latestRun} now={now} />
    </div>
  );
}
