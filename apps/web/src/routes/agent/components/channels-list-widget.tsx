import { ChevronRight, CircleCheck } from "lucide-react";

import type { AgentChannelBindingFieldsFragment } from "@/gql/graphql";
import { ChannelBrandIcon } from "@/shared/ui/channel-brand-icon";

import { DISTRIBUTION_CHANNELS } from "./settings-dialog-model";
import type { ChannelId } from "./settings-dialog-model";

/**
 * Compact list of channel provider rows.
 * Used by:
 *   - Settings modal Distribution block
 *   - Agent Builder right-side panel Channels section
 *
 * Click anywhere on a row → `onOpenChannelView(channelId)`. The parent decides
 * whether that opens the in-modal channels view or a standalone dialog.
 */
export function ChannelsListWidget({
  canManageChannels,
  channelBindings,
  isPublished,
  onOpenChannelView,
}: {
  canManageChannels: boolean;
  channelBindings: AgentChannelBindingFieldsFragment[];
  isPublished: boolean;
  onOpenChannelView: (channelId: ChannelId) => void;
}) {
  return (
    <ul className="divide-border-subtle border-border bg-background divide-y rounded-md border">
      {DISTRIBUTION_CHANNELS.map((channel) => {
        const connected =
          channel.enabled && channelBindings.some((binding) => binding.provider === channel.id);
        const statusLabel = !channel.enabled
          ? "Soon"
          : connected
            ? "Connected"
            : !isPublished
              ? "Publish first"
              : !canManageChannels
                ? "View"
                : "Not connected";

        return (
          <li key={channel.id}>
            <button
              aria-label={`Open ${channel.label} channel settings`}
              className="hover:bg-muted/30 focus-visible:bg-muted/30 flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors"
              onClick={() => {
                onOpenChannelView(channel.id);
              }}
              type="button"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <ChannelBrandIcon channelId={channel.id} className="size-6 shrink-0" />
                <span className="text-foreground min-w-0 truncate text-sm font-medium">
                  {channel.label}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {connected ? (
                  <span className="inline-flex h-5 items-center gap-1 rounded-md border border-green-200 bg-green-50 px-1.5 text-[10.5px] font-medium text-green-800">
                    <CircleCheck className="size-3" />
                    {statusLabel}
                  </span>
                ) : (
                  <span className="text-muted-foreground inline-flex h-5 items-center rounded-md border px-1.5 text-[10.5px] font-medium">
                    {statusLabel}
                  </span>
                )}
                <ChevronRight className="text-muted-foreground size-3.5" />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
