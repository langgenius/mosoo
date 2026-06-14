import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useMemo, useReducer } from "react";
import type { FormEvent } from "react";

import { createSlackAgentChannelBinding } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toAppId } from "@/routes/typed-id";
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

function SlackManifestHelpLink() {
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

interface SlackChannelInlineSetupState {
  appLevelToken: string;
  botToken: string;
  copied: boolean;
  manifestOpen: boolean;
  signingSecret: string;
  threadRepliesRequireMention: boolean;
}

type SlackChannelInlineSetupAction =
  | { type: "changeAppLevelToken"; value: string }
  | { type: "changeBotToken"; value: string }
  | { type: "changeSigningSecret"; value: string }
  | { type: "setCopied"; copied: boolean }
  | { type: "setThreadRepliesRequireMention"; value: boolean }
  | { type: "toggleManifest" };

const SLACK_CHANNEL_INLINE_SETUP_INITIAL_STATE: SlackChannelInlineSetupState = {
  appLevelToken: "",
  botToken: "",
  copied: false,
  manifestOpen: true,
  signingSecret: "",
  threadRepliesRequireMention: false,
};

function slackChannelInlineSetupReducer(
  state: SlackChannelInlineSetupState,
  action: SlackChannelInlineSetupAction,
): SlackChannelInlineSetupState {
  switch (action.type) {
    case "changeAppLevelToken":
      return { ...state, appLevelToken: action.value };
    case "changeBotToken":
      return { ...state, botToken: action.value };
    case "changeSigningSecret":
      return { ...state, signingSecret: action.value };
    case "setCopied":
      return { ...state, copied: action.copied };
    case "setThreadRepliesRequireMention":
      return { ...state, threadRepliesRequireMention: action.value };
    case "toggleManifest":
      return { ...state, manifestOpen: !state.manifestOpen };
  }
}

export function SlackChannelInlineSetup({
  agent,
  onSuccess,
}: {
  agent: ChannelInlineSetupAgent;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(
    slackChannelInlineSetupReducer,
    SLACK_CHANNEL_INLINE_SETUP_INITIAL_STATE,
  );
  const {
    appLevelToken,
    botToken,
    copied,
    manifestOpen,
    signingSecret,
    threadRepliesRequireMention,
  } = state;

  const manifest = useMemo(() => buildSlackManifest(agent.name), [agent.name]);

  const mutation = useMutation({
    mutationFn: createSlackAgentChannelBinding,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.channelBindings(agent.appId, agent.id),
      });
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
    dispatch({ copied: true, type: "setCopied" });
    globalThis.setTimeout(() => {
      dispatch({ copied: false, type: "setCopied" });
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
      appId: toAppId(agent.appId),
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
            dispatch({ type: "toggleManifest" });
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
                dispatch({ type: "changeBotToken", value: event.target.value });
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
                dispatch({ type: "changeSigningSecret", value: event.target.value });
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
                dispatch({ type: "changeAppLevelToken", value: event.target.value });
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
              onCheckedChange={(value) => {
                dispatch({ type: "setThreadRepliesRequireMention", value });
              }}
            />
          </label>
        </div>

        {agent.status !== "published" ? (
          <div className="border-amber/30 bg-amber-bg text-amber-fg mt-4 rounded-md border px-3 py-2 text-xs">
            Publish this Agent before connecting Slack.
          </div>
        ) : null}
        {mutation.error ? (
          <div className="border-ember/25 bg-ember-bg text-ember-fg mt-4 rounded-md border px-3 py-2 text-xs">
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
