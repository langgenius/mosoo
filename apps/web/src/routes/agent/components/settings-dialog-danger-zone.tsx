import { agentKindSupportsResetState } from "@mosoo/contracts/agent";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resetAgentState, unpublishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentDeploymentVersionId, toAgentId, toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { LockKeyhole, PowerOff, RotateCcw, Trash2, XCircle } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";

import type { Agent } from "../agent.types";

function toRuntimeOperationTargetVersion(agent: Agent) {
  if (agent.status !== "published" || agent.liveVersion === null) {
    return null;
  }

  return {
    id: toAgentDeploymentVersionId(agent.liveVersion.id),
    versionNumber: agent.liveVersion.versionNumber,
  };
}

export function AgentSettingsDangerZone({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmResetState, setConfirmResetState] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const [resetConfirmValue, setResetConfirmValue] = useState("");
  const typedAgentId = toAgentId(agent.id);
  const typedProjectId = toProjectId(agent.projectId);
  const resetAgentStateMutation = useMutation({
    mutationFn: resetAgentState,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.detail(variables.projectId, variables.agentId),
      });
    },
  });
  const unpublishMutation = useMutation({
    mutationFn: async () => unpublishAgent(typedProjectId, typedAgentId),
    onSuccess: async () => {
      setConfirmUnpublish(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.projectId, agent.id) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
    },
  });
  const showResetAgentState = agentKindSupportsResetState(agent.kind);
  const showUnpublish = agent.status === "published";

  async function handleResetAgentState() {
    await resetAgentStateMutation.mutateAsync({
      agentId: typedAgentId,
      projectId: typedProjectId,
      targetVersion: toRuntimeOperationTargetVersion(agent),
    });
    setResetConfirmValue("");
    setConfirmResetState(false);
  }

  function handleResetDialogOpenChange(nextOpen: boolean): void {
    setConfirmResetState(nextOpen);

    if (!nextOpen) {
      setResetConfirmValue("");
    }
  }

  return (
    <>
      <div className="space-y-3 px-6 py-5">
        <h3 className="text-destructive text-sm font-semibold">{t("agent.dangerZone")}</h3>

        <div className="divide-border border-border divide-y rounded-lg border">
          {showUnpublish ? (
            confirmUnpublish ? (
              <div className="space-y-2 p-3">
                <p className="text-foreground text-sm">
                  {t("agent.unpublishPrompt", { name: agent.name })}
                </p>
                <p className="text-muted-foreground text-xs">{t("agent.unpublishDescription")}</p>
                {unpublishMutation.error ? (
                  <div className="text-destructive text-xs">
                    {unpublishMutation.error instanceof Error
                      ? unpublishMutation.error.message
                      : t("agent.unpublishFailed")}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    disabled={unpublishMutation.isPending}
                    onClick={() => {
                      setConfirmUnpublish(false);
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    className="border-amber/45 text-amber-fg hover:bg-amber-bg hover:text-amber-fg"
                    disabled={unpublishMutation.isPending}
                    onClick={() => unpublishMutation.mutate()}
                    size="sm"
                    variant="outline"
                  >
                    <PowerOff className="size-3.5" />
                    {unpublishMutation.isPending ? t("agent.unpublishing") : t("agent.unpublish")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="text-foreground text-sm font-medium">
                    {t("agent.unpublishThisAgent")}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {t("agent.unpublishThisAgentDescription")}
                  </p>
                </div>
                <Button
                  className="border-amber/45 text-amber-fg hover:bg-amber-bg hover:text-amber-fg w-24 shrink-0"
                  onClick={() => {
                    setConfirmUnpublish(true);
                  }}
                  size="sm"
                  variant="outline"
                >
                  <PowerOff className="size-3.5" />
                  {t("agent.unpublish")}
                </Button>
              </div>
            )
          ) : null}

          {showResetAgentState ? (
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">
                  {t("agent.resetAgentState")}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("agent.resetAgentStateDescription")}
                </p>
              </div>
              <Button
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive w-24 shrink-0"
                disabled={resetAgentStateMutation.isPending}
                onClick={() => {
                  setConfirmResetState(true);
                }}
                size="sm"
                variant="outline"
              >
                <RotateCcw className="size-3.5" />
                {t("agent.reset")}
              </Button>
            </div>
          ) : null}

          {confirmDelete ? (
            <div className="space-y-2 p-3">
              <p className="text-foreground text-sm">
                {t("agent.deleteAgentPermanently", { name: agent.name })}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmDelete(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button variant="destructive" size="sm">
                  <Trash2 className="size-3.5" />
                  {t("agent.deleteAgent")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">
                  {t("agent.deleteThisAgent")}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("agent.deleteThisAgentDescription")}
                </p>
              </div>
              <Button
                className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive w-24 shrink-0"
                onClick={() => {
                  setConfirmDelete(true);
                }}
                size="sm"
                variant="outline"
              >
                <Trash2 className="size-3.5" />
                {t("common.delete")}
              </Button>
            </div>
          )}
        </div>

        {resetAgentStateMutation.error ? (
          <div className="text-destructive text-xs">
            {resetAgentStateMutation.error instanceof Error
              ? resetAgentStateMutation.error.message
              : t("agent.resetAgentStateFailed")}
          </div>
        ) : null}
      </div>

      <Dialog open={confirmResetState} onOpenChange={handleResetDialogOpenChange}>
        <DialogContent className="border-destructive/60 rounded-lg sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("agent.resetAgentStatePrompt", { name: agent.name })}</DialogTitle>
            <DialogDescription>{t("agent.resetAgentStateDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="border-destructive/20 bg-destructive/[0.04] rounded-lg border p-3">
              <div className="border-destructive/20 bg-destructive/10 text-destructive inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold">
                <XCircle className="size-3.5" />
                <LockKeyhole className="size-3.5" />
                {t("agent.agentStateWillBeCleared")}
              </div>
              <div className="text-muted-foreground mt-3 space-y-3 text-xs leading-5">
                <div>
                  <div className="text-foreground font-medium">{t("agent.whatWillBeCleared")}</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>{t("agent.loginState")}</li>
                    <li>{t("agent.cache")}</li>
                    <li>{t("agent.longTermMemory")}</li>
                    <li>{t("agent.sessionRuntimeDirs")}</li>
                    <li>{t("agent.nativeRuntimeResume")}</li>
                  </ul>
                </div>
                <div>
                  <div className="text-foreground font-medium">
                    {t("agent.whatWillBePreserved")}
                  </div>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    <li>{t("agent.agentProfile")}</li>
                    <li>{t("agent.sessionFiles")}</li>
                    <li>{t("agent.pastSessions")}</li>
                    <li>{t("agent.costHistory")}</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium" htmlFor="reset-agent-state">
                {t("agent.typeAgentNameToConfirm", { name: agent.name })}
              </label>
              <Input
                placeholder={t("agent.agentNamePlaceholder")}
                id="reset-agent-state"
                onChange={(event) => {
                  setResetConfirmValue(event.target.value);
                }}
                value={resetConfirmValue}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setConfirmResetState(false);
                  setResetConfirmValue("");
                }}
                size="sm"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={
                  resetAgentStateMutation.isPending || resetConfirmValue.trim() !== agent.name
                }
                onClick={() => void handleResetAgentState()}
                size="sm"
                variant="destructive"
              >
                {t("agent.resetAgentState")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
