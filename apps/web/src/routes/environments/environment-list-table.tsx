import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { GitFork, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { EnvironmentBadges } from "./environment-badges";

export interface EnvironmentListTableProps {
  readonly environments: readonly EnvironmentSummary[];
  readonly onDelete: (environmentId: string) => void;
  readonly onSetDefault: (environmentId: string) => void;
}

function networkLabel({ allowedHosts, networkPolicy }: EnvironmentSummary): string {
  if (networkPolicy === "full") {
    return "Full intent · not enforced";
  }

  return `Limited intent · ${allowedHosts.length} hosts · not enforced`;
}

export function EnvironmentListTable({
  environments,
  onDelete,
  onSetDefault,
}: EnvironmentListTableProps): ReactElement {
  // Delete is destructive and irreversible, so it sits behind a confirm dialog
  // (same convention as deleting a deployment in deploy-actions.tsx).
  const [confirmingDelete, setConfirmingDelete] = useState<EnvironmentSummary | null>(null);

  function confirmDelete(): void {
    if (confirmingDelete !== null) {
      onDelete(confirmingDelete.id);
    }
    setConfirmingDelete(null);
  }

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      {environments.map((environment, index) => (
        <div
          className={cn(
            "grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_160px_90px_120px_auto]",
            index !== environments.length - 1 && "border-b border-border-soft",
          )}
          key={environment.id}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="text-fg-1 hover:text-accent-press truncate text-[14px] font-semibold"
                to={`/environment/${environment.id}`}
              >
                {environment.name}
              </Link>
              <EnvironmentBadges environment={environment} />
            </div>
            <div className="text-fg-3 mt-1 line-clamp-1 text-[12px]">
              {environment.description || "No description"}
            </div>
            {environment.forkOrigin ? (
              <div className="text-fg-3 mt-1 flex items-center gap-1.5 text-[11.5px]">
                <GitFork className="size-3" />
                Forked from {environment.forkOrigin.ownerName}'s {environment.forkOrigin.name}
              </div>
            ) : null}
          </div>
          <div className="text-fg-2 text-[12px]">{networkLabel(environment)}</div>
          <div className="text-fg-2 font-mono text-[12px]">{environment.usedByAgentCount}</div>
          <div className="text-fg-3 text-[12px]" suppressHydrationWarning>
            {new Date(environment.updatedAt).toLocaleDateString("en-US")}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Environment actions"
                className="size-8"
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/environment/${environment.id}`}>Open</Link>
              </DropdownMenuItem>
              {environment.canEdit && !environment.isDefault ? (
                <DropdownMenuItem
                  onClick={() => {
                    onSetDefault(environment.id);
                  }}
                >
                  Set as App default
                </DropdownMenuItem>
              ) : null}
              {environment.canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setConfirmingDelete(environment);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      <Dialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmingDelete(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this environment?</DialogTitle>
            <DialogDescription>
              This permanently deletes{" "}
              <span className="text-fg-1 font-semibold">{confirmingDelete?.name}</span> from this
              App and cannot be undone.
              {confirmingDelete !== null && confirmingDelete.usedByAgentCount > 0
                ? ` It is currently used by ${String(confirmingDelete.usedByAgentCount)} ${
                    confirmingDelete.usedByAgentCount === 1 ? "agent" : "agents"
                  }.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmingDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="size-4" />
              Delete environment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
