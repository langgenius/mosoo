import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { createDiscordAgentChannelBinding } from "@/domains/agent/api/agent-client";
import { useInvalidateAgentChannelBindings } from "@/domains/agent/query/agent-queries";
import { toAgentId, toAppId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";

const DISCORD_DEVELOPER_PORTAL_URL = "https://discord.com/developers/applications";

export function DiscordChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation();
  const invalidateChannelBindings = useInvalidateAgentChannelBindings(agent.appId, agent.id);
  const [applicationId, setApplicationId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [relaySecret, setRelaySecret] = useState("");

  const mutation = useMutation({
    mutationFn: createDiscordAgentChannelBinding,
    onSuccess: async () => {
      await invalidateChannelBindings();
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
      appId: toAppId(agent.appId),
      relaySecret: relaySecret.trim(),
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <section className="border-border bg-card rounded-lg border p-4">
        <div className="border-amber/30 bg-amber-bg text-amber-fg mb-4 rounded-md border px-3 py-2 text-xs leading-relaxed">
          {t("agent.discordIntentsPrerequisite")}{" "}
          <a
            className="underline underline-offset-2 hover:no-underline"
            href={DISCORD_DEVELOPER_PORTAL_URL}
            rel="noreferrer"
            target="_blank"
          >
            {t("agent.openDiscordDeveloperPortal")}
          </a>
          .
        </div>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="discord-application-id">{t("agent.applicationId")}</Label>
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
            <Label htmlFor="discord-bot-token">{t("agent.botToken")}</Label>
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
            <Label htmlFor="discord-relay-secret">{t("agent.relaySecret")}</Label>
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
          {t("agent.discordSetupCaveat")}
        </div>

        {agent.status !== "published" ? (
          <div className="border-amber/30 bg-amber-bg text-amber-fg mt-4 rounded-md border px-3 py-2 text-xs">
            {t("agent.publishBeforeConnectingDiscord")}
          </div>
        ) : null}
        {mutation.error ? (
          <div className="border-ember/25 bg-ember-bg text-ember-fg mt-4 rounded-md border px-3 py-2 text-xs">
            {mutation.error instanceof Error
              ? mutation.error.message
              : t("agent.discordSetupFailed")}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button disabled={!canSubmit} type="submit">
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </div>
      </section>
    </form>
  );
}
