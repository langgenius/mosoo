import { ChevronDown, Code2, GitBranch, Rocket } from "lucide-react";
import { Fragment, useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import { DEPLOY_TARGET_LABELS } from "../deploy-console-data";
import type { DeploymentRunVM } from "../deploy-console-data";
import { relativeLabel } from "../deploy-console-mapping";
import { useNowTick } from "../use-now-tick";
import { StatusBadge } from "./deploy-status-badge";

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
 * branch HEAD; failed runs expose their error inline below the row.
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
    <>
      <div className="space-y-2 md:hidden">
        {runs.map((run) => {
          const failedError = run.outcome === "failed" ? (run.errorMessage ?? run.errorCode) : null;
          const expanded = expandedRunIds.has(run.id);

          return (
            <article className="border-border rounded-xl border p-4" key={run.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
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
                <StatusBadge outcome={run.outcome} />
              </div>

              <div className="text-fg-2 mt-3 flex min-w-0 items-start gap-1.5 text-[13px]">
                <Code2 className="text-fg-3 mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0 break-words">
                  commit <span className="text-fg-1 font-mono">{run.commitSha}</span>
                  <span className="text-fg-3"> · default branch HEAD</span>
                </span>
              </div>
              <div className="text-fg-3 mt-1 flex items-center gap-1.5 text-[12px]">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="font-mono">
                  {run.targetKind === null
                    ? "detecting target"
                    : DEPLOY_TARGET_LABELS[run.targetKind]}
                </span>
              </div>

              {failedError === null ? null : (
                <>
                  <button
                    aria-expanded={expanded}
                    className="text-fg-3 hover:text-fg-1 focus-visible:ring-ring mt-2 inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2"
                    onClick={() => toggleRun(run.id)}
                    type="button"
                  >
                    Details
                    <ChevronDown
                      className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
                    />
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 ease-out",
                      expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="border-border bg-bg-sunken/40 mt-1 rounded-md border px-3.5 py-2.5 text-[13px]">
                        <div className="text-fg-3 mb-1 text-[11.5px] font-medium">
                          Failure details
                        </div>
                        {run.errorCode === null ? null : (
                          <span className="text-destructive mr-2 font-mono text-[12px] font-semibold">
                            {run.errorCode}
                          </span>
                        )}
                        <span className="text-fg-2 break-words">{run.errorMessage ?? ""}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>

      <div className="border-border hidden overflow-hidden rounded-xl border md:block">
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
                run.outcome === "failed" ? (run.errorMessage ?? run.errorCode) : null;
              const expanded = expandedRunIds.has(run.id);
              return (
                <Fragment key={run.id}>
                  <TableRow>
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
                      <StatusBadge outcome={run.outcome} />
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
                          <div className="text-fg-3 mt-0.5 flex items-center gap-1.5 text-[12px]">
                            <GitBranch className="size-3.5" />
                            <span className="font-mono">
                              {run.targetKind === null
                                ? "detecting target"
                                : DEPLOY_TARGET_LABELS[run.targetKind]}
                            </span>
                          </div>
                        </div>
                        {failedError === null ? null : (
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
                  {failedError === null ? null : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={3} className="px-5 pt-0 pb-0">
                        <div
                          className={cn(
                            "grid transition-[grid-template-rows] duration-200 ease-out",
                            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                          )}
                        >
                          <div className="overflow-hidden">
                            <div className="pb-4">
                              <div className="border-border bg-bg-sunken/40 rounded-md border px-3.5 py-2.5 text-[13px]">
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
                            </div>
                          </div>
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
    </>
  );
}
