import { MoreHorizontal, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import type { DeploymentRunOutcome } from "../deployment-status";
import type { LocalDeploymentPreviewStatus } from "../local-preview-url";

type DeployActionScope = "development" | "production";

/**
 * Header actions for a deployed App: the primary Redeploy/Retry button, plus an
 * overflow menu holding "Delete deployment" behind a confirm dialog. Rendered
 * only when a deployment exists.
 */
export function DeployActions({
  appName,
  agentCount,
  latestOutcome,
  deploying,
  canDeploy,
  onRetry,
  onDelete,
  scope = "production",
  developmentStatus = null,
}: {
  appName: string;
  agentCount: number;
  latestOutcome: DeploymentRunOutcome | null;
  deploying: boolean;
  canDeploy: boolean;
  onRetry: () => void;
  onDelete: () => void;
  scope?: DeployActionScope;
  developmentStatus?: LocalDeploymentPreviewStatus | null;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const label =
    scope === "development"
      ? deploying
        ? "Checking development..."
        : developmentStatus === "online"
          ? "Refresh development"
          : "Retry development"
      : deploying
        ? "Refreshing production…"
        : latestOutcome === "failed"
          ? "Retry production"
          : "Refresh production";

  function confirmDelete() {
    onDelete();
    setConfirmingDelete(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={deploying || !canDeploy}>
        <RotateCw className={cn("size-3.5", deploying && "animate-spin")} />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="More deployment actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          <DropdownMenuItem
            className="gap-2"
            variant="destructive"
            onSelect={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-3.5" />
            Delete deployment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this deployment?</DialogTitle>
            <DialogDescription>
              This removes the deployment for{" "}
              <span className="text-fg-1 font-semibold">{appName}</span>, its Cloudflare Worker, and
              the {agentCount} agent bindings. The public repo is the source of truth and is
              untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="size-4" />
              Delete deployment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
