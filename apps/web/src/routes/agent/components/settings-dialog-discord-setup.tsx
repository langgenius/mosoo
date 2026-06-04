import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { createDiscordAgentChannelBinding } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";

const DISCORD_RELAY_SECRET_LABEL = "Relay Secret";
const DISCORD_DEVELOPER_PORTAL_URL = "https://discord.com/developers/applications";
const DiscordSetupCaveat =
  "Save validates the bot token with Discord. The Gateway connection starts after the binding exists; send a real DM or guild mention after saving to verify delivery in your workspace.";
const DiscordIntentsPrerequisite =
  "Before connecting, open your app in the Discord Developer Portal → Bot → Privileged Gateway Intents and enable Message Content Intent. Without it Discord closes the Gateway with discord_gateway_disallowed_intents and the bot cannot read message text.";

export function DiscordChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [relaySecret, setRelaySecret] = useState("");

  const mutation = useMutation({
    mutationFn: createDiscordAgentChannelBinding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(agent.id) });
      onSuccess?.();
    },
  });

  const canSubmit =
    agent.status === "published" &&
    applicationId.trim().length > 0 &&
    botToken.trim().length > 0 &&
    relaySecret.trim().length > 0 &&
    !mutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    mutation.mutate({
      agentId: toAgentId(agent.id),
      applicationId: applicationId.trim(),
      botToken: botToken.trim(),
      relaySecret: relaySecret.trim(),
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <section className="border-border bg-card rounded-lg border p-4">
        <div className="border-border-subtle mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {DiscordIntentsPrerequisite}{" "}
          <a
            className="underline underline-offset-2 hover:no-underline"
            href={DISCORD_DEVELOPER_PORTAL_URL}
            rel="noreferrer"
            target="_blank"
          >
            Open Discord Developer Portal
          </a>
          .
        </div>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="discord-application-id">Application ID</Label>
            <Input
              autoComplete="off"
              id="discord-application-id"
              onChange={(event) => {
                setApplicationId(event.target.value);
              }}
              value={applicationId}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="discord-bot-token">Bot Token</Label>
            <Input
              autoComplete="off"
              id="discord-bot-token"
              onChange={(event) => {
                setBotToken(event.target.value);
              }}
              type="password"
              value={botToken}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="discord-relay-secret">{DISCORD_RELAY_SECRET_LABEL}</Label>
            <Input
              autoComplete="off"
              id="discord-relay-secret"
              onChange={(event) => {
                setRelaySecret(event.target.value);
              }}
              type="password"
              value={relaySecret}
            />
          </div>
        </div>

        <div className="border-border-subtle bg-muted/20 text-muted-foreground mt-4 rounded-md border px-3 py-2 text-xs leading-relaxed">
          {DiscordSetupCaveat}
        </div>

        {agent.status !== "published" ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Publish this Agent before connecting Discord.
          </div>
        ) : null}
        {mutation.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            {mutation.error instanceof Error ? mutation.error.message : "Discord setup failed."}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button disabled={!canSubmit} type="submit">
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </section>
    </form>
  );
}
