import { useState } from "react";

import { useAgentChannelBindingsQuery } from "@/domains/agent/query/agent-queries";

import type { Agent } from "../agent.types";
import { ChannelsConfigDialog } from "./channels-config-dialog";
import { ChannelsListWidget } from "./channels-list-widget";
import type { ChannelId } from "./settings-dialog-model";

/**
 * Channels field for the Agent Builder right-side panel.
 * Renders the same list widget as the Settings modal Distribution block,
 * and opens the LobeHub-style list/detail config in a standalone dialog
 * when a row is clicked.
 */
export function AgentChannelsField({ agent }: { agent: Agent }) {
  const [activeChannelId, setActiveChannelId] = useState<ChannelId | null>(null);
  const channelBindingsQuery = useAgentChannelBindingsQuery(agent.appId, agent.id);
  const canManageChannels = agent.role === "owner";
  const isPublished = agent.status === "published";

  return (
    <>
      <ChannelsListWidget
        canManageChannels={canManageChannels}
        channelBindings={channelBindingsQuery.data ?? []}
        isPublished={isPublished}
        onOpenChannelView={(channelId) => {
          setActiveChannelId(channelId);
        }}
      />
      {activeChannelId !== null ? (
        <ChannelsConfigDialog
          agent={agent}
          initialChannelId={activeChannelId}
          onOpenChange={(open) => {
            if (!open) {
              setActiveChannelId(null);
            }
          }}
          open={true}
        />
      ) : null}
    </>
  );
}
