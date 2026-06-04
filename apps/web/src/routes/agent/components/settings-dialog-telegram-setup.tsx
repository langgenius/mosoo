import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { createTelegramAgentChannelBinding } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";

export function TelegramChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const mutation = useMutation({
    mutationFn: createTelegramAgentChannelBinding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(agent.id) });
      onSuccess?.();
    },
  });

  const canSubmit =
    agent.status === "published" &&
    botToken.trim().length > 0 &&
    webhookSecret.trim().length > 0 &&
    !mutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    mutation.mutate({
      agentId: toAgentId(agent.id),
      botToken: botToken.trim(),
      webhookSecret: webhookSecret.trim(),
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <section className="border-border bg-card rounded-lg border p-4">
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="telegram-bot-token">Bot Token</Label>
            <Input
              autoComplete="off"
              id="telegram-bot-token"
              onChange={(event) => {
                setBotToken(event.target.value);
              }}
              type="password"
              value={botToken}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="telegram-webhook-secret">Webhook Secret</Label>
            <Input
              autoComplete="off"
              id="telegram-webhook-secret"
              onChange={(event) => {
                setWebhookSecret(event.target.value);
              }}
              type="password"
              value={webhookSecret}
            />
          </div>
        </div>

        {agent.status !== "published" ? (
          <div className="border-amber/30 bg-amber-bg text-amber-fg mt-4 rounded-md border px-3 py-2 text-xs">
            Publish this Agent before connecting Telegram.
          </div>
        ) : null}
        {mutation.error ? (
          <div className="border-ember/25 bg-ember-bg text-ember-fg mt-4 rounded-md border px-3 py-2 text-xs">
            {mutation.error instanceof Error ? mutation.error.message : "Telegram setup failed."}
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
