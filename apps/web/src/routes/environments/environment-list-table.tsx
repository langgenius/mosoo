import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { GitFork, MoreHorizontal } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
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
  readonly onFork: (environmentId: string) => void;
  readonly onSetDefault: (environmentId: string) => void;
}

function networkLabel({ allowedHosts, networkPolicy }: EnvironmentSummary): string {
  if (networkPolicy === "full") {
    return "Full network";
  }

  return `Limited · ${allowedHosts.length} hosts`;
}

export function EnvironmentListTable({
  environments,
  onDelete,
  onFork,
  onSetDefault,
}: EnvironmentListTableProps): ReactElement {
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
            {new Date(environment.updatedAt).toLocaleDateString()}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="size-8" size="icon" variant="ghost">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/environment/${environment.id}`}>Open</Link>
              </DropdownMenuItem>
              {environment.role === "user" && !environment.isBuiltIn ? (
                <DropdownMenuItem
                  onClick={() => {
                    onFork(environment.id);
                  }}
                >
                  Fork
                </DropdownMenuItem>
              ) : null}
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
                    onClick={() => {
                      onDelete(environment.id);
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
    </div>
  );
}
