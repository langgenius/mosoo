import { ChevronDown, Code2, GitBranch, Rocket } from "lucide-react";
import { Fragment, useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import { deployTargetLine } from "../deploy-console-data";
import type { DeploymentRunVM, NativeRunFailureVM } from "../deploy-console-data";
import { relativeLabel } from "../deploy-console-mapping";
import { useNowTick } from "../use-now-tick";
import { StatusBadge } from "./deploy-status-badge";

/**
 * Severity tint of the `[severity]` tag on a failure row. `setup_required` is
 * a neutral setup note (the repo is fine, the instance needs a value), so it
 * must not read as red.
 */
const FAILURE_SEVERITY_CLASSES: Record<NativeRunFailureVM["severity"], string> = {
  error: "text-destructive",
  setup_required: "text-fg-2",
  warning: "text-amber-fg",
};

const PRE_DEPLOY_HINT =
  "After your first production deploy, every build shows up here: commit · status · target · duration.";

function ActivityPlaceholder({ children }: { children: string }) {
  return (
    <p className="text-fg-3 border-border bg-bg-sunken/50 rounded-xl border border-dashed px-4 py-8 text-center text-[13px]">
      {children}
    </p>
  );
}

/**
 * The Activity section of the Overview: one row per deployment run (newest
 * first), a dashed placeholder before any run exists, and an inline error when
 * the run-list read failed while the rest of the page loaded fine.
 */
export function ActivitySection({
  className,
  error = null,
  preDeploy = false,
  runs,
}: {
  className?: string;
  /** `appDeploymentRunList` read error — history is missing, not empty. */
  error?: string | null;
  /** Pre-deploy Overview: explain what will appear here instead of "empty". */
  preDeploy?: boolean;
  runs: DeploymentRunVM[];
}) {
  return (
    <section className={className}>
      <h2 className="text-fg-1 mb-4 text-[15px] font-semibold">Production Activity</h2>
      {error === null ? null : (
        <p className="text-destructive mb-2 text-[13px]">
          Couldn&apos;t load the run history: {error}
        </p>
      )}
      {runs.length > 0 ? (
        <DeploymentsHistory runs={runs} />
      ) : (
        <ActivityPlaceholder>
          {preDeploy ? PRE_DEPLOY_HINT : "No deployment runs yet."}
        </ActivityPlaceholder>
      )}
    </section>
  );
}

/**
 * Deployment runs for the App, newest first. Every deploy targets the default
 * branch HEAD. The Details expander is data-driven: per-agent provisioning
 * rows and repo-term validate failures for protocol (mosoo-native) runs, plus
 * the run-level error code and message when the run failed.
 */
export function DeploymentsHistory({ runs }: { runs: DeploymentRunVM[] }) {
  const now = useNowTick();
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<string>>(() => new Set());

  function toggleRun(runId: string): void {
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  return (
    <div className="border-border overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-fg-3 h-11 pl-5 text-[13px] font-medium">Deploy</TableHead>
            <TableHead className="text-fg-3 h-11 text-[13px] font-medium">Status</TableHead>
            <TableHead className="text-fg-3 h-11 pr-5 text-[13px] font-medium">Changes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const failedError =
              run.status === "failed" ? (run.errorMessage ?? run.errorCode) : null;
            const hasNativeDetails =
              run.native !== null &&
              (run.native.agents.length > 0 || run.native.failures.length > 0);
            const expandable = failedError !== null || hasNativeDetails;
            const expanded = expandable && expandedRunIds.has(run.id);
            return (
              <Fragment key={run.id}>
                <TableRow data-testid="deploy-run-row">
                  <TableCell className="py-4 pl-5">
                    <div className="flex items-center gap-3">
                      <span className="bg-bg-sunken text-fg-3 flex size-8 shrink-0 items-center justify-center rounded-full">
                        <Rocket className="size-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-fg-1 text-[13.5px] font-semibold">
                          {run.number === null ? "Deploy" : `Deploy #${String(run.number)}`}
                        </div>
                        <div className="text-fg-3 text-[12.5px]">
                          {relativeLabel(run.createdAt, now)}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-4 align-middle">
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="py-4 pr-5 align-middle">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-fg-2 flex min-w-0 items-center gap-1.5 text-[13px]">
                          <Code2 className="text-fg-3 size-3.5 shrink-0" />
                          <span>commit</span>
                          <span className="text-fg-1 truncate font-mono">{run.commitSha}</span>
                          <span className="text-fg-3">· default branch HEAD</span>
                        </div>
                        <div
                          data-testid="deploy-run-detection"
                          className="text-fg-3 mt-0.5 flex items-center gap-1.5 text-[12px]"
                        >
                          <GitBranch className="size-3.5" />
                          <span className="font-mono">{deployTargetLine(run)}</span>
                        </div>
                      </div>
                      {!expandable ? null : (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => toggleRun(run.id)}
                          className="text-fg-3 hover:text-fg-1 focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2"
                        >
                          Details
                          <ChevronDown
                            className={cn(
                              "size-3.5 transition-transform",
                              expanded && "rotate-180",
                            )}
                          />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {!expanded ? null : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="px-5 pt-0 pb-4">
                      <div
                        data-testid="deploy-run-details"
                        className="border-border bg-bg-sunken/40 flex flex-col gap-2.5 rounded-md border px-3.5 py-2.5 text-[13px]"
                      >
                        {failedError === null ? null : (
                          <div>
                            <div className="text-fg-3 mb-1 text-[11.5px] font-medium">
                              Failure details
                            </div>
                            {run.errorCode === null ? null : (
                              <span className="text-destructive mr-2 font-mono text-[12px] font-semibold">
                                {run.errorCode}
                              </span>
                            )}
                            <span className="text-fg-2">{run.errorMessage ?? ""}</span>
                          </div>
                        )}
                        {run.native === null || run.native.agents.length === 0 ? null : (
                          <div className="flex flex-col gap-1">
                            {run.native.agents.map((agent) => (
                              <div
                                key={agent.name}
                                data-testid="deploy-provision-row"
                                className="text-fg-2 flex flex-wrap items-center gap-x-1.5 text-[12.5px]"
                              >
                                <span className="text-fg-1 font-mono">{agent.name}</span>
                                <span className="text-fg-3">·</span>
                                <span
                                  className={cn(
                                    agent.action === "failed" && "text-destructive font-medium",
                                  )}
                                >
                                  {agent.action}
                                </span>
                                {agent.versionNumber === undefined ? null : (
                                  <>
                                    <span className="text-fg-3">·</span>
                                    <span className="font-mono">
                                      v{String(agent.versionNumber)}
                                    </span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {run.native === null || run.native.failures.length === 0 ? null : (
                          <div className="flex flex-col gap-2">
                            {run.native.failures.map((failure) => (
                              <div
                                key={`${failure.code}:${failure.file}:${failure.field ?? ""}`}
                                data-testid="deploy-failure-row"
                              >
                                <div className="flex flex-wrap items-baseline gap-x-1.5">
                                  <span
                                    className={cn(
                                      "font-mono text-[12px] font-semibold",
                                      FAILURE_SEVERITY_CLASSES[failure.severity],
                                    )}
                                  >
                                    [{failure.severity}]
                                  </span>
                                  <span className="text-fg-1 font-mono text-[12.5px]">
                                    {failure.file}
                                    {failure.field === undefined ? "" : `:${failure.field}`}
                                  </span>
                                  <span className="text-fg-2">— {failure.problem}</span>
                                </div>
                                <div className="text-fg-3 pl-4 text-[12.5px]">{failure.action}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
