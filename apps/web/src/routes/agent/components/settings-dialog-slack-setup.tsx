import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { createSlackAgentChannelBinding } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";
import {
  SLACK_APP_LEVEL_TOKEN_LABEL,
  SLACK_MANIFEST_HELP_URL,
  SLACK_THREAD_REPLY_MENTION_LABEL,
  buildSlackManifest,
} from "./settings-dialog-slack-manifest";

export function SlackManifestHelpLink() {
  return (
    <a
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
      href={SLACK_MANIFEST_HELP_URL}
      rel="noreferrer"
      target="_blank"
    >
      Where do I paste this YAML?
      <ExternalLink className="size-3.5" />
    </a>
  );
}

export function SlackChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [appLevelToken, setAppLevelToken] = useState("");
  const [threadRepliesRequireMention, setThreadRepliesRequireMention] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const manifest = useMemo(() => buildSlackManifest(agent.name), [agent.name]);

  const mutation = useMutation({
    mutationFn: createSlackAgentChannelBinding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.channelBindings(agent.id) });
      onSuccess?.();
    },
  });

  const canSubmit =
    agent.status === "published" &&
    botToken.trim().length > 0 &&
    signingSecret.trim().length > 0 &&
    !mutation.isPending;

  async function handleCopyManifest() {
    await navigator.clipboard.writeText(manifest);
    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1500);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    mutation.mutate({
      agentId: toAgentId(agent.id),
      appLevelToken: appLevelToken.trim() || null,
      botToken: botToken.trim(),
      signingSecret: signingSecret.trim(),
      threadRepliesRequireMention,
    });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <section className="border-border bg-card rounded-lg border">
        <button
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          onClick={() => {
            setManifestOpen((value) => !value);
          }}
          type="button"
        >
          <span className="text-foreground text-sm font-semibold">Manifest YAML</span>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-4 transition-transform",
              manifestOpen ? "rotate-180" : "",
            )}
          />
        </button>
        {manifestOpen ? (
          <div className="border-border-subtle border-t p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <SlackManifestHelpLink />
              <Button
                aria-label={copied ? "Copied manifest" : "Copy manifest"}
                onClick={() => {
                  void handleCopyManifest();
                }}
                size="xs"
                type="button"
                variant="outline"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                Copy
              </Button>
            </div>
            <Textarea
              className="min-h-72 resize-y font-mono text-[12px]"
              readOnly
              value={manifest}
            />
          </div>
        ) : null}
      </section>

      <section className="border-border bg-card rounded-lg border p-4">
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="slack-bot-token">Bot Token</Label>
            <Input
              autoComplete="off"
              id="slack-bot-token"
              onChange={(event) => {
                setBotToken(event.target.value);
              }}
              type="password"
              value={botToken}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="slack-signing-secret">Signing Secret</Label>
            <Input
              autoComplete="off"
              id="slack-signing-secret"
              onChange={(event) => {
                setSigningSecret(event.target.value);
              }}
              type="password"
              value={signingSecret}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="slack-app-level-token">{SLACK_APP_LEVEL_TOKEN_LABEL}</Label>
            <Input
              autoComplete="off"
              id="slack-app-level-token"
              onChange={(event) => {
                setAppLevelToken(event.target.value);
              }}
              type="password"
              value={appLevelToken}
            />
          </div>
          <label
            className="border-border-subtle flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            htmlFor="slack-thread-reply-mention"
          >
            <span className="text-foreground text-sm font-medium">
              {SLACK_THREAD_REPLY_MENTION_LABEL}
            </span>
            <Switch
              checked={threadRepliesRequireMention}
              id="slack-thread-reply-mention"
              onCheckedChange={setThreadRepliesRequireMention}
            />
          </label>
        </div>

        {agent.status !== "published" ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Publish this Agent before connecting Slack.
          </div>
        ) : null}
        {mutation.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            {mutation.error instanceof Error ? mutation.error.message : "Slack setup failed."}
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
