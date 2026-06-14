import { Bot, Box, CircleCheck, Plug, Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { useAuth } from "@/domains/auth/use-auth";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { ChannelBrandIcon } from "@/shared/ui/channel-brand-icon";

import { mapAgentSummaryToListView } from "../agent/agent-view.mapper";
import type { Agent } from "../agent/agent.types";
import { ChannelsConfigDialog } from "../agent/components/channels-config-dialog";
import type { ChannelId } from "../agent/components/settings-dialog-model";
import { DISTRIBUTION_CHANNELS } from "../agent/components/settings-dialog-model";

function ChannelProviderStrip({
  selectedChannelId,
  onSelectChannel,
}: {
  selectedChannelId: ChannelId;
  onSelectChannel: (channelId: ChannelId) => void;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Plug className="text-muted-foreground size-4" />
        <h2 className="text-foreground text-sm font-semibold">Providers</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {DISTRIBUTION_CHANNELS.map((channel) => (
          <button
            key={channel.id}
            type="button"
            disabled={!channel.enabled}
            onClick={() => {
              onSelectChannel(channel.id);
            }}
            className={cn(
              "border-border bg-background hover:bg-muted flex h-11 items-center justify-between gap-2 rounded-md border px-3 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45",
              selectedChannelId === channel.id ? "border-primary bg-primary/5 text-primary" : "",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ChannelBrandIcon channelId={channel.id} className="size-5 shrink-0" />
              <span className="truncate">{channel.label}</span>
            </span>
            {selectedChannelId === channel.id ? <CircleCheck className="size-4 shrink-0" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentChannelCard({
  agent,
  selectedChannelId,
  onConfigure,
}: {
  agent: Agent;
  selectedChannelId: ChannelId;
  onConfigure: (agent: Agent) => void;
}) {
  const statusLabel = agent.status === "published" ? "Published" : "Draft";

  return (
    <article className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-foreground truncate text-sm font-semibold">{agent.name}</h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {agent.description.length > 0 ? agent.description : "App-local Agent"}
              </p>
            </div>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            agent.status === "published"
              ? "bg-success/10 text-success"
              : "bg-muted text-muted-foreground",
          )}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChannelBrandIcon channelId={selectedChannelId} className="size-5 shrink-0" />
          <span className="text-muted-foreground text-xs">
            {DISTRIBUTION_CHANNELS.find((channel) => channel.id === selectedChannelId)?.label}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            onConfigure(agent);
          }}
        >
          <Radio className="size-4" />
          Configure channels
        </Button>
      </div>
    </article>
  );
}

export function ChannelsPage() {
  const { activeApp, activeAppId, appsLoading } = useAppSession();
  const { user } = useAuth();
  const agentsQuery = useVisibleAgentsQuery(activeAppId);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<ChannelId>("slack");
  const agents = useMemo(
    () => (agentsQuery.data ?? []).map((agent) => mapAgentSummaryToListView(agent, user)),
    [agentsQuery.data, user],
  );

  if (activeApp === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? "Loading app..." : "No app available."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 items-center justify-between gap-4 border-b px-8 py-5">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
            <Box className="size-3.5" />
            App Channels
          </div>
          <h1 className="text-foreground mt-1 truncate text-2xl font-semibold tracking-normal">
            Channels
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Configure external delivery for {activeApp.name}, then bind an App-local Agent to handle
            messages.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/agent?create=1">
            <Bot className="size-4" />
            New agent
          </Link>
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <ChannelProviderStrip
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
          />

          {agentsQuery.error ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
              App channels failed to load. Refresh after checking App access.
            </div>
          ) : null}
          {agentsQuery.isLoading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-3 text-sm">
              Loading App channels...
            </div>
          ) : null}

          {agentsQuery.isLoading || agents.length > 0 ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {agents.map((agent) => (
                <AgentChannelCard
                  key={agent.id}
                  agent={agent}
                  selectedChannelId={selectedChannelId}
                  onConfigure={setSelectedAgent}
                />
              ))}
            </section>
          ) : (
            <section className="border-border bg-card rounded-lg border px-4 py-10 text-center">
              <Bot className="text-muted-foreground mx-auto size-7" />
              <h2 className="text-foreground mt-3 text-sm font-semibold">No Agents yet</h2>
              <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">
                Create an App-local Agent before connecting a channel.
              </p>
              <Button asChild className="mt-4">
                <Link to="/agent?create=1">
                  <Bot className="size-4" />
                  New agent
                </Link>
              </Button>
            </section>
          )}
        </div>
      </main>

      {selectedAgent ? (
        <ChannelsConfigDialog
          agent={selectedAgent}
          initialChannelId={selectedChannelId}
          open={true}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setSelectedAgent(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
