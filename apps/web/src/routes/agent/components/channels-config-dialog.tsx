import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { deleteAgentChannelBinding } from "@/domains/agent/api/agent-client";
import { agentKeys, useAgentChannelBindingsQuery } from "@/domains/agent/query/agent-queries";
import { toChannelBindingId, toAppId } from "@/routes/typed-id";
import { Dialog, DialogContent } from "@/shared/ui/dialog";

import type { Agent } from "../agent.types";
import { AgentSettingsChannelsView } from "./settings-dialog-channels-view";
import type { ChannelId } from "./settings-dialog-model";

/**
 * Standalone Channels configuration dialog — same provider list / detail body
 * as the Settings modal flow, but lives in its own Dialog instance so it can be
 * opened from anywhere outside the Settings modal (e.g. the Agent Builder
 * right-hand panel).
 *
 * No "Back to Settings" arrow: closing the dialog is the only way out.
 */
export function ChannelsConfigDialog({
  agent,
  initialChannelId,
  onOpenChange,
  open,
}: {
  agent: Agent;
  initialChannelId: ChannelId;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedChannelId, setSelectedChannelId] = useState<ChannelId>(initialChannelId);

  const channelBindingsQuery = useAgentChannelBindingsQuery(agent.appId, agent.id);
  const deleteChannelBindingMutation = useMutation({
    mutationFn: deleteAgentChannelBinding,
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: agentKeys.channelBindings(agent.appId, agent.id),
      }),
  });

  const canManageChannels = agent.role === "owner";
  const isPublished = agent.status === "published";
  const pendingRemoveBindingId = deleteChannelBindingMutation.isPending
    ? deleteChannelBindingMutation.variables.bindingId
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[860px]">
        <AgentSettingsChannelsView
          agent={agent}
          canManageChannels={canManageChannels}
          channelBindings={channelBindingsQuery.data ?? []}
          channelBindingsLoading={channelBindingsQuery.isLoading}
          isPublished={isPublished}
          onRemoveChannelBinding={async (bindingId) =>
            deleteChannelBindingMutation.mutateAsync({
              bindingId: toChannelBindingId(bindingId),
              appId: toAppId(agent.appId),
            })
          }
          onSelectChannel={(channelId) => {
            setSelectedChannelId(channelId);
          }}
          pendingRemoveBindingId={pendingRemoveBindingId}
          selectedChannelId={selectedChannelId}
        />
      </DialogContent>
    </Dialog>
  );
}
