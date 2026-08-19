import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { GitFork, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { getCurrentLocale, useTranslation } from "@/shared/i18n";
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

type Translate = (key: string, variables?: Record<string, string>) => string;

function networkLabel(environment: EnvironmentSummary, t: Translate): string {
  if (environment.networkPolicy === "full") {
    return t("environments.networkFullLabel");
  }

  return t("environments.networkLimitedLabel", {
    count: String(environment.allowedHosts.length),
  });
}

export function EnvironmentListTable({
  environments,
  onDelete,
  onSetDefault,
}: EnvironmentListTableProps): ReactElement {
  const { t } = useTranslation();

  // Delete is destructive and irreversible, so it sits behind a confirm dialog
  // Keep destructive actions explicit and separate from row navigation.
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
              {environment.description || t("environments.noDescription")}
            </div>
            {environment.forkOrigin ? (
              <div className="text-fg-3 mt-1 flex items-center gap-1.5 text-[11.5px]">
                <GitFork className="size-3" />
                {t("environments.forkedFrom", {
                  owner: environment.forkOrigin.ownerName,
                  name: environment.forkOrigin.name,
                })}
              </div>
            ) : null}
          </div>
          <div className="text-fg-2 text-[12px]">{networkLabel(environment, t)}</div>
          <div className="text-fg-2 font-mono text-[12px]">{environment.usedByAgentCount}</div>
          <div className="text-fg-3 text-[12px]" suppressHydrationWarning>
            {new Date(environment.updatedAt).toLocaleDateString(getCurrentLocale())}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t("environments.actions")}
                className="size-8"
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/environment/${environment.id}`}>{t("common.open")}</Link>
              </DropdownMenuItem>
              {environment.canEdit && !environment.isDefault ? (
                <DropdownMenuItem
                  onClick={() => {
                    onSetDefault(environment.id);
                  }}
                >
                  {t("environments.setAsAppDefault")}
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
                    {t("common.delete")}
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
            <DialogTitle>{t("environments.deletePrompt")}</DialogTitle>
            <DialogDescription>
              {t("environments.deleteDescription", {
                name: confirmingDelete?.name ?? "",
              })}
              {confirmingDelete !== null && confirmingDelete.usedByAgentCount > 0
                ? t(
                    confirmingDelete.usedByAgentCount === 1
                      ? "environments.deleteInUseOne"
                      : "environments.deleteInUseMany",
                    { count: String(confirmingDelete.usedByAgentCount) },
                  )
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
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              <Trash2 className="size-4" />
              {t("environments.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
