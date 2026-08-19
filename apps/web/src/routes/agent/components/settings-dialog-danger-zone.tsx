import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PowerOff, Trash2 } from "lucide-react";
import { useState } from "react";

import { deleteAgent, unpublishAgent } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toAppId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";

export function AgentSettingsDangerZone({ agent }: { agent: Agent }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const typedAgentId = toAgentId(agent.id);
  const typedAppId = toAppId(agent.appId);
  const unpublishMutation = useMutation({
    mutationFn: async () => unpublishAgent(typedAppId, typedAgentId),
    onSuccess: async () => {
      setConfirmUnpublish(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.appId, agent.id) }),
        queryClient.invalidateQueries({ queryKey: agentKeys.lists() }),
      ]);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async () => deleteAgent({ agentId: typedAgentId, appId: typedAppId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
      globalThis.location.assign("/agent");
    },
  });

  return (
    <div className="space-y-3 px-6 py-5">
      <h3 className="text-destructive text-sm font-semibold">{t("agent.dangerZone")}</h3>
      <div className="divide-border border-border divide-y rounded-lg border">
        {agent.status === "published" ? (
          confirmUnpublish ? (
            <div className="space-y-2 p-3">
              <p className="text-foreground text-sm">
                {t("agent.unpublishPrompt", { name: agent.name })}
              </p>
              <p className="text-muted-foreground text-xs">{t("agent.unpublishDescription")}</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setConfirmUnpublish(false)} size="sm" variant="ghost">
                  {t("common.cancel")}
                </Button>
                <Button
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
              <div>
                <div className="text-foreground text-sm font-medium">
                  {t("agent.unpublishThisAgent")}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t("agent.unpublishThisAgentDescription")}
                </p>
              </div>
              <Button onClick={() => setConfirmUnpublish(true)} size="sm" variant="outline">
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
            {deleteMutation.error instanceof Error ? (
              <p className="text-destructive text-xs">{deleteMutation.error.message}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmDelete(false)} size="sm" variant="ghost">
                {t("common.cancel")}
              </Button>
              <Button
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                size="sm"
                variant="destructive"
              >
                <Trash2 className="size-3.5" />
                {t("agent.deleteAgent")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 p-3">
            <div>
              <div className="text-foreground text-sm font-medium">
                {t("agent.deleteThisAgent")}
              </div>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t("agent.deleteThisAgentDescription")}
              </p>
            </div>
            <Button onClick={() => setConfirmDelete(true)} size="sm" variant="outline">
              <Trash2 className="text-destructive size-3.5" />
              {t("common.delete")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
