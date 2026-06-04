import { ArrowDown, Loader2, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";
import { FamilyFilterDropdown } from "./system-log-controls";
import { formatRelativeTime } from "./system-log-model";
import { SystemLogRow } from "./system-log-row";
import { useSystemLogFeed } from "./use-system-log-feed";

export function SystemLogMode({ agent }: { agent: Agent }): ReactElement {
  const feed = useSystemLogFeed(agent.id);

  return (
    <div className="bg-paper-200 flex h-full flex-col" data-testid="agent-system-log">
      <header className="border-border-subtle sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b bg-white px-5 py-3">
        <div className="min-w-0">
          <div className="text-foreground text-[14px] font-medium">System Log</div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]">
            <span>{feed.eventCount} events</span>
            <span>·</span>
            <span>
              {feed.lastRefreshedAt === null
                ? "Waiting for first refresh"
                : `Last refreshed ${formatRelativeTime(
                    new Date(feed.lastRefreshedAt).toISOString(),
                  )}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <FamilyFilterDropdown
            selectedFamilies={feed.selectedFamilySet}
            onReset={feed.resetFamilyFilter}
            onToggle={feed.toggleFamily}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={feed.refreshLatest}
            aria-label="Refresh system log"
          >
            <span className={cn("inline-flex", feed.isFetching && "animate-spin")}>
              <RefreshCw aria-hidden="true" size={16} />
            </span>
          </Button>
        </div>
      </header>

      {feed.liveTailPaused ? (
        <div className="border-border-subtle bg-amber-bg text-amber-fg border-b px-5 py-2 text-[12px] font-medium">
          Live tail paused, retrying…
        </div>
      ) : null}

      <div
        ref={feed.setScrollContainerNode}
        onScroll={feed.trackScroll}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {feed.isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-[13px]">
            <span className="inline-flex animate-spin">
              <Loader2 aria-hidden="true" size={16} />
            </span>
            Loading system events…
          </div>
        ) : feed.initialLoadFailed ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-[360px] text-center">
              <div className="text-foreground text-[13px] font-medium">System log unavailable</div>
              <div className="text-muted-foreground mt-1 text-[12px]">{feed.liveErrorMessage}</div>
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={feed.refreshLatest}>
                  Retry
                </Button>
              </div>
            </div>
          </div>
        ) : feed.empty ? (
          <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-[13px]">
            No runtime events yet. The agent has not been provisioned. Trigger a session to start.
          </div>
        ) : feed.searchingOlder ? (
          <div
            ref={feed.setOlderSearchNode}
            className="text-muted-foreground flex h-full items-center justify-center gap-2 px-6 text-center text-[13px]"
          >
            <span className="inline-flex animate-spin">
              <Loader2 aria-hidden="true" size={16} />
            </span>
            Searching older runtime events…
          </div>
        ) : (
          <div ref={feed.setScrollContentNode} className="min-h-full py-3">
            <div className="mx-auto w-full max-w-[1280px] px-5">
              <div className="mb-3 flex justify-center">
                {feed.pagination.hasMoreOlder && feed.pagination.olderCursor ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={feed.loadingOlder}
                    onClick={() => {
                      void feed.loadOlder();
                    }}
                  >
                    {feed.loadingOlder ? (
                      <span className="inline-flex animate-spin">
                        <Loader2 aria-hidden="true" size={14} />
                      </span>
                    ) : null}
                    Load more (older)
                  </Button>
                ) : (
                  <Badge variant="outline">Start of history</Badge>
                )}
              </div>

              {feed.loadOlderError ? (
                <div className="border-ember/25 bg-ember-bg text-ember-fg mb-3 rounded-md border px-3 py-2 text-[12px]">
                  {feed.loadOlderError}
                </div>
              ) : null}

              <div className="border-border-subtle overflow-hidden rounded-md border bg-white">
                {feed.displayEvents.map((event) => (
                  <SystemLogRow key={event.id} event={event} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {!feed.isSticky && feed.newEventCount > 0 ? (
        <button
          type="button"
          onClick={feed.scrollToBottom}
          className="bg-foreground text-background fixed right-8 bottom-8 z-20 inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12px] font-semibold shadow-lg"
        >
          <ArrowDown aria-hidden="true" size={14} />
          {feed.newEventCount} new events
        </button>
      ) : null}
    </div>
  );
}
