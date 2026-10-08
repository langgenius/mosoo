import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { unpublishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { PowerOff, Trash2 } from "@/shared/ui/icons";

import type { Agent } from "../agent.types";

export function AgentSettingsDangerZone({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const typedAgentId = toAgentId(agent.id);
  const typedProjectId = toProjectId(agent.projectId);
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
  const showUnpublish = agent.status === "published";

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
      </div>
    </>
  );
}
