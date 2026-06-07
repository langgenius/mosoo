import { buildAgentChannelWebhookUrl } from "@mosoo/contracts/channel";
import {
  Activity,
  ArrowLeft,
  Check,
  CircleCheck,
  Copy,
  Inbox,
  Plug,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import type { AgentChannelBindingFieldsFragment } from "@/gql/graphql";
import { toChannelBindingId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ChannelBrandIcon } from "@/shared/ui/channel-brand-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { resolveChannelWebhookOrigin } from "./channel-webhook-origin";
import type { ChannelInlineSetupAgent } from "./settings-dialog-channel-agent";
import { DiscordChannelInlineSetup } from "./settings-dialog-discord-setup";
import { LarkChannelInlineSetup } from "./settings-dialog-lark-setup";
import { DISTRIBUTION_CHANNELS } from "./settings-dialog-model";
import type { ChannelId } from "./settings-dialog-model";
import { SlackChannelInlineSetup } from "./settings-dialog-slack-setup";
import { TelegramChannelInlineSetup } from "./settings-dialog-telegram-setup";
import { WeChatChannelInlineSetup } from "./settings-dialog-wechat-setup";

function readMetadataString(
  binding: AgentChannelBindingFieldsFragment,
  key: string,
): string | null {
  const value = binding.displayMetadata[key];
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed.length > 0 ? trimmed : null;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatTimestamp(value: string): string {
  return TIMESTAMP_FORMATTER.format(new Date(value));
}

function getOperatorWebhookUrl(channelId: ChannelId, bindingId: string): string | null {
  const origin = resolveChannelWebhookOrigin();

  switch (channelId) {
    case "slack":
      return buildAgentChannelWebhookUrl({ origin, provider: channelId });
    case "lark":
    case "telegram":
      return buildAgentChannelWebhookUrl({
        bindingId: toChannelBindingId(bindingId),
        origin,
        provider: channelId,
      });
    case "discord":
    case "wechat":
      return null;
    default: {
      const exhaustiveChannelId: never = channelId;
      return exhaustiveChannelId;
    }
  }
}

function getDiscordBindingErrorCopy(errorCode: string): string | null {
  if (errorCode === "discord_gateway_disallowed_intents") {
    return "Discord refused the connection because Message Content Intent is disabled. Open the Discord Developer Portal → Bot → Privileged Gateway Intents, enable Message Content Intent, save, then disconnect and reconnect Discord here.";
  }

  if (errorCode === "discord_gateway_authentication_failed") {
    return "Discord rejected the bot token. Reset the token in the Discord Developer Portal, then disconnect and reconnect Discord here with the new value.";
  }

  return null;
}

function getTelegramBotDeepLink(botUsername: string | null): string | null {
  const normalized = botUsername?.trim().replace(/^@/u, "") ?? "";

  return normalized ? `https://t.me/${encodeURIComponent(normalized)}` : null;
}

interface ConnectionSummary {
  detailHref?: string | null;
  detailIconLabel: string;
  detailTitle: string;
  detailValue: string | null;
}

function getConnectionSummary(
  binding: AgentChannelBindingFieldsFragment,
  channelId: ChannelId,
): ConnectionSummary {
  if (channelId === "slack") {
    return {
      detailIconLabel: "Workspace",
      detailTitle:
        readMetadataString(binding, "workspace_name") ??
        binding.externalTenantId ??
        "Slack workspace",
      detailValue: readMetadataString(binding, "bot_handle") ?? binding.externalBotId,
    };
  }

  if (channelId === "lark") {
    const domain = readMetadataString(binding, "domain");
    const domainLabel = domain === "lark" ? "Lark" : "Feishu";

    return {
      detailIconLabel: "App",
      detailTitle: readMetadataString(binding, "app_name") ?? binding.externalTenantId,
      detailValue: `${domainLabel} / ${readMetadataString(binding, "bot_open_id") ?? binding.externalBotId}`,
    };
  }

  if (channelId === "telegram") {
    const username = readMetadataString(binding, "bot_username");
    return {
      detailHref: getTelegramBotDeepLink(username),
      detailIconLabel: "Bot",
      detailTitle: username
        ? `@${username}`
        : (readMetadataString(binding, "bot_first_name") ?? "Telegram bot"),
      detailValue: binding.externalBotId,
    };
  }

  return {
    detailIconLabel: "Channel",
    detailTitle: binding.externalTenantId,
    detailValue: binding.externalBotId,
  };
}

function ChannelConnectionPanel({
  binding,
  canManageChannels,
  channelId,
  channelLabel,
  onRemove,
  pendingRemove,
}: {
  binding: AgentChannelBindingFieldsFragment;
  canManageChannels: boolean;
  channelId: ChannelId;
  channelLabel: string;
  onRemove: () => void;
  pendingRemove: boolean;
}) {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const summary = getConnectionSummary(binding, channelId);
  const statusTone =
    binding.status === "active"
      ? "border-green-200 bg-green-50 text-green-800"
      : "border-amber/30 bg-amber-bg text-amber-fg";
  const webhookUrl = getOperatorWebhookUrl(channelId, binding.id);

  async function handleCopyWebhook() {
    if (!webhookUrl) {
      return;
    }

    await navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    globalThis.setTimeout(() => {
      setCopiedWebhook(false);
    }, 1500);
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-foreground text-sm font-semibold">Connection</div>
        <span
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium ${statusTone}`}
        >
          {binding.status === "active" ? (
            <CircleCheck className="size-3" />
          ) : (
            <TriangleAlert className="size-3" />
          )}
          {binding.status === "active" ? "Active" : "Error"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] font-medium">
            <Plug className="size-3" />
            {summary.detailIconLabel}
          </div>
          <div className="text-foreground truncate text-sm font-medium">
            {summary.detailHref ? (
              <a
                className="hover:underline"
                href={summary.detailHref}
                rel="noreferrer"
                target="_blank"
              >
                {summary.detailTitle}
              </a>
            ) : (
              summary.detailTitle
            )}
          </div>
          <div className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {summary.detailValue}
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[11px] font-medium">
            <Activity className="size-3" />
            Activity
          </div>
          <div className="text-foreground truncate text-sm font-medium">
            {binding.activityLastTriggeredAt
              ? formatTimestamp(binding.activityLastTriggeredAt)
              : "No channel sessions yet"}
          </div>
          <div className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {binding.activitySessionCount7d} sessions in last 7 days
          </div>
        </div>
      </div>
      {webhookUrl ? (
        <div className="mt-4 grid gap-1.5">
          <div className="text-muted-foreground text-[11px] font-medium">Webhook URL</div>
          <div className="flex min-w-0 gap-2">
            <code className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 text-[11px]">
              {webhookUrl}
            </code>
            <Button
              aria-label={copiedWebhook ? "Copied webhook URL" : "Copy webhook URL"}
              onClick={() => {
                void handleCopyWebhook();
              }}
              size="xs"
              type="button"
              variant="outline"
            >
              {copiedWebhook ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              Copy
            </Button>
          </div>
        </div>
      ) : null}
      {binding.status === "error" && binding.lastErrorCode ? (
        <div className="border-amber/30 bg-amber-bg text-amber-fg mt-3 rounded-md border px-3 py-2 text-xs">
          {channelId === "discord"
            ? (getDiscordBindingErrorCopy(binding.lastErrorCode) ??
              `${channelLabel} delivery failed with ${binding.lastErrorCode}. Remove and reconnect ${channelLabel} to recover.`)
            : `${channelLabel} delivery failed with ${binding.lastErrorCode}. Remove and reconnect ${channelLabel} to recover.`}
        </div>
      ) : null}
      {canManageChannels ? (
        <div className="mt-4 flex justify-end">
          <Button disabled={pendingRemove} onClick={onRemove} size="sm" variant="outline">
            <Trash2 className="size-3.5" />
            Disconnect {channelLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ComingSoonPanel({ channelLabel }: { channelLabel: string }) {
  return (
    <div className="border-border bg-muted/20 rounded-lg border px-5 py-10 text-center">
      <Inbox className="text-muted-foreground mx-auto mb-3 size-8" />
      <div className="text-foreground text-sm font-medium">{channelLabel} support is coming</div>
      <p className="text-muted-foreground mx-auto mt-2 max-w-sm text-xs leading-relaxed">
        We're working on letting agents talk to your team through {channelLabel}. Pick another
        channel for now, or come back soon.
      </p>
    </div>
  );
}

export function AgentSettingsChannelsView({
  agent,
  canManageChannels,
  channelBindings,
  channelBindingsLoading,
  isPublished,
  onBackToSettings,
  onRemoveChannelBinding,
  onSelectChannel,
  pendingRemoveBindingId,
  selectedChannelId,
}: {
  agent: ChannelInlineSetupAgent;
  canManageChannels: boolean;
  channelBindings: AgentChannelBindingFieldsFragment[];
  channelBindingsLoading: boolean;
  isPublished: boolean;
  onBackToSettings?: () => void;
  onRemoveChannelBinding: (bindingId: string) => Promise<void> | void;
  onSelectChannel: (channelId: ChannelId) => void;
  pendingRemoveBindingId: string | null;
  selectedChannelId: ChannelId;
}) {
  const selectedChannel = DISTRIBUTION_CHANNELS.find((channel) => channel.id === selectedChannelId);
  const selectedBinding =
    channelBindings.find((binding) => binding.provider === selectedChannelId) ?? null;
  const [confirmRemoveBinding, setConfirmRemoveBinding] =
    useState<AgentChannelBindingFieldsFragment | null>(null);

  if (!selectedChannel) {
    return null;
  }

  return (
    <>
      <DialogHeader className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-1.5">
          {onBackToSettings ? (
            <Button
              aria-label="Back to Agent Settings"
              className="text-muted-foreground -ml-1.5"
              onClick={onBackToSettings}
              size="icon-xs"
              variant="ghost"
            >
              <ArrowLeft className="size-3.5" />
            </Button>
          ) : null}
          <DialogTitle className="text-base">Channels</DialogTitle>
        </div>
        <DialogDescription>
          Connect {agent.name} to external messaging channels so callers can reach it from their
          tools.
        </DialogDescription>
      </DialogHeader>

      <div className="border-border-subtle flex min-h-0 flex-1 border-t">
        <nav className="border-border-subtle bg-muted/20 w-[180px] shrink-0 overflow-y-auto border-r py-2">
          {DISTRIBUTION_CHANNELS.map((channel) => {
            const connected = channelBindings.some((binding) => binding.provider === channel.id);
            const isActive = selectedChannelId === channel.id;
            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  isActive
                    ? "bg-background text-foreground font-medium"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
                key={channel.id}
                onClick={() => {
                  onSelectChannel(channel.id);
                }}
                type="button"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <ChannelBrandIcon channelId={channel.id} className="size-5 shrink-0" />
                  <span className="min-w-0 truncate">{channel.label}</span>
                </div>
                {!channel.enabled ? (
                  <span className="text-muted-foreground text-[10px]">Soon</span>
                ) : connected ? (
                  <CircleCheck className="size-3.5 text-green-600" />
                ) : null}
              </button>
            );
          })}
        </nav>

        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-center gap-2">
            <ChannelBrandIcon channelId={selectedChannel.id} className="size-6 shrink-0" />
            <div className="text-foreground text-sm font-semibold">{selectedChannel.label}</div>
            {selectedBinding ? (
              <Badge variant="primary">Connected</Badge>
            ) : !selectedChannel.enabled ? (
              <Badge variant="default">Soon</Badge>
            ) : null}
          </div>

          {!selectedChannel.enabled ? (
            <ComingSoonPanel channelLabel={selectedChannel.label} />
          ) : channelBindingsLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : selectedBinding ? (
            <ChannelConnectionPanel
              binding={selectedBinding}
              canManageChannels={canManageChannels}
              channelId={selectedChannel.id}
              channelLabel={selectedChannel.label}
              onRemove={() => {
                setConfirmRemoveBinding(selectedBinding);
              }}
              pendingRemove={pendingRemoveBindingId === selectedBinding.id}
            />
          ) : !isPublished ? (
            <div className="border-amber/30 bg-amber-bg text-amber-fg rounded-md border px-3 py-2 text-xs">
              Publish this Agent before connecting {selectedChannel.label}.
            </div>
          ) : !canManageChannels ? (
            <div className="border-border bg-muted/20 text-muted-foreground rounded-md border px-3 py-2 text-xs">
              Only Owners and Admins can connect channels for this agent.
            </div>
          ) : selectedChannel.id === "slack" ? (
            <SlackChannelInlineSetup agent={agent} />
          ) : selectedChannel.id === "lark" ? (
            <LarkChannelInlineSetup agent={agent} />
          ) : selectedChannel.id === "discord" ? (
            <DiscordChannelInlineSetup agent={agent} />
          ) : selectedChannel.id === "telegram" ? (
            <TelegramChannelInlineSetup agent={agent} />
          ) : selectedChannel.id === "wechat" ? (
            <WeChatChannelInlineSetup agent={agent} />
          ) : (
            <ComingSoonPanel channelLabel={selectedChannel.label} />
          )}
        </section>
      </div>

      <Dialog
        open={confirmRemoveBinding !== null}
        onOpenChange={(nextOpen) => {
          if (pendingRemoveBindingId !== null) {
            return;
          }

          if (!nextOpen) {
            setConfirmRemoveBinding(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Remove channel binding?</DialogTitle>
            <DialogDescription>
              Events for this channel app will be acknowledged and dropped after removal.
            </DialogDescription>
          </DialogHeader>
          <div className="text-muted-foreground space-y-2 text-sm">
            <p>The Agent will no longer respond in the connected channel surface.</p>
            <p>Existing Mosoo Sessions keep their channel source metadata.</p>
            <p>To recover, create a new binding and paste the credentials again.</p>
          </div>
          <DialogFooter>
            <Button
              disabled={pendingRemoveBindingId !== null}
              onClick={() => {
                setConfirmRemoveBinding(null);
              }}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={pendingRemoveBindingId !== null || confirmRemoveBinding === null}
              onClick={() => {
                if (confirmRemoveBinding) {
                  void (async () => {
                    await onRemoveChannelBinding(confirmRemoveBinding.id);
                    setConfirmRemoveBinding(null);
                  })();
                }
              }}
              size="sm"
              variant="destructive"
            >
              <Trash2 className="size-3.5" />
              {pendingRemoveBindingId !== null ? "Removing..." : "Remove binding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
