import { Rocket } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/shared/lib/class-names";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import { DEPLOY_TARGET_LABELS } from "../deploy-console-data";
import type { DeploymentRunVM } from "../deploy-console-data";
import { relativeLabel } from "../deploy-console-mapping";
import { useNowTick } from "../use-now-tick";
import { StatusBadge } from "./deploy-status-badge";

const PRE_DEPLOY_HINT =
  "After your first deploy, every build shows up here: commit · status · target · duration.";

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
      <h2 className="text-fg-1 mb-4 text-[15px] font-semibold">Activity</h2>
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
            return (
              <Fragment key={run.id}>
                <TableRow className={cn(failedError !== null && "border-0")}>
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
                    <div className="text-fg-2 text-[13px]">
                      commit <span className="text-fg-1 font-mono">{run.commitSha}</span>
                      <span className="text-fg-3"> · default branch HEAD</span>
                    </div>
                    <div className="text-fg-3 mt-0.5 font-mono text-[12px]">
                      {run.targetKind === null ? "—" : DEPLOY_TARGET_LABELS[run.targetKind]}
                    </div>
                  </TableCell>
                </TableRow>
                {failedError === null ? null : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="px-5 pt-0 pb-4">
                      <div className="bg-destructive/6 rounded-lg px-3.5 py-2 text-[13px]">
                        {run.errorCode === null ? null : (
                          <span className="text-destructive mr-2 font-mono text-[12px] font-semibold">
                            {run.errorCode}
                          </span>
                        )}
                        <span className="text-fg-2">{run.errorMessage ?? ""}</span>
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
