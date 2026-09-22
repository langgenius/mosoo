import type { SessionRuntimeOperationName, SessionSummary } from "@mosoo/contracts/session";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  recreateSessionSandbox,
  restartSessionDriver,
} from "@/domains/session/api/session-runtime";
import { useTranslation } from "@/shared/i18n";
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
import { Settings } from "@/shared/ui/icons";

// Mount with key={session.id}: a confirmation always belongs to the selected Session.
export function SessionRuntimeControls({
  session,
}: {
  session: Pick<SessionSummary, "id" | "projectId" | "title" | "status" | "archivedAt">;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<SessionRuntimeOperationName | null>(null);
  const mutation = useMutation({
    mutationFn: async (requested: SessionRuntimeOperationName) => {
      const input = { projectId: session.projectId, sessionId: session.id };
      await (requested === "restartDriver"
        ? restartSessionDriver(input)
        : recreateSessionSandbox(input));
    },
    onSuccess: async () => {
      setOperation(null);
      await queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey.includes(session.id) ||
          queryKey[0] === "agent-session-list" ||
          (queryKey[0] === "threads" && queryKey[1] === session.projectId),
      });
    },
  });
  const unavailable =
    mutation.isPending ||
    session.archivedAt !== null ||
    (session.status !== "IDLE" && session.status !== "RUNNING");
  const label =
    operation === "recreateSandbox" ? t("agent.recreateSession") : t("agent.restartSession");
  function choose(next: SessionRuntimeOperationName) {
    mutation.reset();
    setOperation(next);
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("agent.sessionMaintenance")}
            disabled={unavailable}
            size="icon-sm"
            variant="ghost"
          >
            <Settings className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => choose("restartDriver")}>
            {t("agent.restartSession")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("recreateSandbox")}>
            {t("agent.recreateSession")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={operation !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setOperation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{t("agent.sessionMaintenanceDescription")}</DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-xs break-all">{session.title ?? session.id}</p>
          {mutation.error ? (
            <p className="text-destructive text-sm" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={mutation.isPending}
              onClick={() => setOperation(null)}
              variant="ghost"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={unavailable || operation === null}
              onClick={() => {
                if (operation !== null) mutation.mutate(operation);
              }}
            >
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
