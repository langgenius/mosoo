import { Fragment } from "react";

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
    <p className="text-fg-3 border-border bg-bg-sunken rounded-lg border border-dashed px-4 py-6 text-center text-[13px]">
      {children}
    </p>
  );
}

/**
 * The Activity block of the Overview: one row per deployment run (newest
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
      <h2 className="text-fg-3 mb-3 text-[10.5px] font-semibold tracking-wider uppercase">
        Activity
      </h2>
      {error === null ? null : (
        <p className="text-destructive mb-2 text-[12.5px]">
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
    <div className="border-border bg-background overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-fg-3 w-14 pl-4 text-[12px] font-medium">#</TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">
              commit (default HEAD)
            </TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">target</TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">when</TableHead>
            <TableHead className="text-fg-3 pr-4 text-[12px] font-medium">status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const error = run.status === "failed" ? (run.errorMessage ?? run.errorCode) : null;
            return (
              <Fragment key={run.id}>
                <TableRow>
                  <TableCell className="text-fg-1 pl-4 font-mono text-[12.5px]">
                    {run.number === null ? "—" : `#${String(run.number)}`}
                  </TableCell>
                  <TableCell className="text-fg-1 font-mono text-[12.5px]">
                    {run.commitSha}
                  </TableCell>
                  <TableCell className="text-fg-3 font-mono text-[12px]">
                    {run.targetKind === null ? "—" : DEPLOY_TARGET_LABELS[run.targetKind]}
                  </TableCell>
                  <TableCell className="text-fg-3 text-[12.5px]">
                    {relativeLabel(run.createdAt, now)}
                  </TableCell>
                  <TableCell className="pr-4">
                    <StatusBadge status={run.status} />
                  </TableCell>
                </TableRow>
                {error === null ? null : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="pt-0 pb-2.5 pl-4">
                      <div className="bg-destructive/8 rounded-md px-3 py-1.5 text-[12.5px]">
                        {run.errorCode === null ? null : (
                          <span className="text-destructive mr-2 font-mono font-semibold">
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
