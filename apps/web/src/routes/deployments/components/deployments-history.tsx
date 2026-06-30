import { RotateCw, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import type { DeploymentRunVM } from "../deploy-console-data";
import { StatusBadge } from "./deploy-status-badge";

const IN_FLIGHT: ReadonlySet<string> = new Set([
  "queued",
  "preparing",
  "building",
  "submitting",
  "submitted",
  "activating",
]);

/**
 * Deployment runs for the App. Every deploy targets the default branch HEAD;
 * retry redeploys that HEAD (not a rollback to an arbitrary version).
 */
export function DeploymentsHistory({
  runs,
  deploying,
  onRetry,
  onDelete,
}: {
  runs: DeploymentRunVM[];
  deploying: boolean;
  onRetry: () => void;
  onDelete: () => void;
}) {
  if (runs.length === 0) {
    return (
      <p className="text-fg-3 border-border bg-bg-sunken rounded-lg border border-dashed px-4 py-6 text-center text-[13px]">
        No deployment runs yet.
      </p>
    );
  }

  return (
    <div className="border-border bg-background overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-fg-3 w-14 pl-4 text-[12px] font-medium">#</TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">
              commit (default HEAD)
            </TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">worker</TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">created</TableHead>
            <TableHead className="text-fg-3 text-[12px] font-medium">status</TableHead>
            <TableHead className="text-fg-3 pr-4 text-right text-[12px] font-medium">
              actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const isLive = run.status === "success" || IN_FLIGHT.has(run.status);
            return (
              <TableRow key={run.id}>
                <TableCell className="text-fg-1 pl-4 font-mono text-[12.5px]">
                  #{run.number}
                </TableCell>
                <TableCell className="text-fg-1 font-mono text-[12.5px]">{run.commitSha}</TableCell>
                <TableCell className="text-fg-3 font-mono text-[12px]">{run.workerName}</TableCell>
                <TableCell className="text-fg-3 text-[12.5px]">{run.createdLabel}</TableCell>
                <TableCell>
                  <StatusBadge status={run.status} />
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-1">
                    {isLive ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={onRetry}
                        disabled={deploying}
                        aria-label={`Retry deploy #${run.number}`}
                      >
                        <RotateCw className="size-3" />
                        retry
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={onDelete}
                      aria-label={`Delete app (from #${run.number})`}
                    >
                      <Trash2 className="text-destructive size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
