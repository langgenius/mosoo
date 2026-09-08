import type { EnvironmentSummary } from "@mosoo/contracts/environment";
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { getCurrentLocale, useTranslation } from "@/shared/i18n";
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
import { GitFork, MoreHorizontal, Trash2 } from "@/shared/ui/icons";
import { DataRow, RowList } from "@/shared/ui/list-row";
import { MonoText } from "@/shared/ui/mono-text";

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

// One 40px data row per environment; a description or fork origin adds whole
// lines below the name instead of squeezing the row.
export function EnvironmentListTable({
  environments,
  onDelete,
  onSetDefault,
}: EnvironmentListTableProps): ReactElement {
  const { t } = useTranslation();

  // Delete is destructive and irreversible, so it sits behind a confirm dialog.
  const [confirmingDelete, setConfirmingDelete] = useState<EnvironmentSummary | null>(null);

  function confirmDelete(): void {
    if (confirmingDelete !== null) {
      onDelete(confirmingDelete.id);
    }
    setConfirmingDelete(null);
  }

  return (
    <RowList>
      {environments.map((environment) => (
        <DataRow
          interactive
          className="grid gap-3 px-4 md:grid-cols-[minmax(0,1.4fr)_160px_90px_120px_auto]"
          key={environment.id}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                className="text-fg-heading hover:text-link truncate text-[13px] font-medium hover:underline"
                to={`/environment/${environment.id}`}
              >
                {environment.name}
              </Link>
              <EnvironmentBadges environment={environment} />
            </div>
            {environment.description ? (
              <div className="text-fg-3 mt-0.5 line-clamp-1 text-[12px] leading-4">
                {environment.description}
              </div>
            ) : null}
            {environment.forkOrigin ? (
              <div className="text-fg-3 mt-0.5 flex items-center gap-1.5 text-[12px] leading-4">
                <GitFork className="size-3" />
                {t("environments.forkedFrom", {
                  owner: environment.forkOrigin.ownerName,
                  name: environment.forkOrigin.name,
                })}
              </div>
            ) : null}
          </div>
          <div className="text-fg-2 text-[12px]">{networkLabel(environment, t)}</div>
          <MonoText className="text-fg-2">{environment.usedByAgentCount}</MonoText>
          <div className="text-fg-3 text-[12px]" suppressHydrationWarning>
            {new Date(environment.updatedAt).toLocaleDateString(getCurrentLocale())}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t("environments.actions")} size="icon-sm" variant="ghost">
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
                  {t("environments.setAsProjectDefault")}
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
        </DataRow>
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
    </RowList>
  );
}
