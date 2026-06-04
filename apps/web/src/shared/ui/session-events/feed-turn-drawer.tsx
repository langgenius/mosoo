import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import {
  getSessionEventChipTone,
  getSessionEventDomain,
  getSessionEventLabel,
  isSessionEventAttentionWorthy,
  isSessionEventVisibleInMainFeed,
  SESSION_EVENT_DOMAIN_LABEL,
  SESSION_EVENT_DOMAIN_TONE,
  SESSION_EVENT_FILTER_DOMAINS,
  summarizeSessionEvent,
} from "./domain";
import { SessionEventDrawerCore } from "./drawer-core";
import {
  clipPreview,
  createSessionEventCopyText,
  turnStatusClassName,
  turnStatusLabel,
} from "./feed-display";
import { formatDuration, formatOffset, formatTokens, formatTotalDuration } from "./format";
import { calculateSessionTurnTokens, countSessionTurnDomains } from "./turns";
import type { SessionTurn } from "./turns";

function SessionTimelineBar({
  events,
  onSelect,
  selectedId,
}: {
  events: readonly SessionProcessEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}): ReactElement {
  return (
    <div className="border-border-subtle bg-muted/10 flex h-7 min-w-0 items-center gap-0.5 overflow-hidden rounded-md border p-1">
      {events.map((event) => {
        const domain = getSessionEventDomain(event.type);
        const tone = SESSION_EVENT_DOMAIN_TONE[domain];
        const selected = selectedId === event.id;
        const attention = isSessionEventAttentionWorthy(event);

        return (
          <button
            key={event.id}
            type="button"
            onClick={() => {
              onSelect(event.id);
            }}
            aria-label={`Select ${getSessionEventLabel(event.type)}`}
            style={{ flexGrow: Math.max(event.durationMs ?? 1, 1) }}
            className={cn(
              "h-full min-w-[2px] rounded-[1px] border text-[0] transition-colors",
              attention
                ? "border-destructive/40 bg-destructive/40"
                : cn("border-transparent", tone.bar),
              selected ? "ring-1 ring-ink-900/55 ring-inset" : "",
            )}
          />
        );
      })}
    </div>
  );
}

function SessionTimeline({
  events,
  onSelect,
  selectedId,
}: {
  events: readonly SessionProcessEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}): ReactElement {
  const totalDurationMs = events.reduce((total, event) => total + (event.durationMs ?? 0), 0);

  return (
    <>
      <div className="text-fg-3 flex items-center justify-between text-[10.5px] tabular-nums">
        <span>0:00</span>
        <span>{formatTotalDuration(totalDurationMs)}</span>
      </div>
      <SessionTimelineBar events={events} onSelect={onSelect} selectedId={selectedId} />
    </>
  );
}

function SessionEventLegend({ events }: { events: readonly SessionProcessEvent[] }): ReactElement {
  const counts = countSessionTurnDomains(events);

  return (
    <div className="text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
      {SESSION_EVENT_FILTER_DOMAINS.map((domain) => (
        <span key={domain} className="inline-flex items-center gap-1">
          <span className={cn("size-2 rounded-sm", SESSION_EVENT_DOMAIN_TONE[domain].swatch)} />
          <span>
            {SESSION_EVENT_DOMAIN_LABEL[domain]} {counts[domain]}
          </span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="border-destructive/40 bg-destructive/40 size-2 rounded-sm border" />
        <span>Error</span>
      </span>
    </div>
  );
}

function DrawerEventRow({
  event,
  expanded,
  index,
  offsetMs,
  onSelect,
  onToggleExpanded,
  selected,
}: {
  event: SessionProcessEvent;
  expanded: boolean;
  index: number;
  offsetMs: number;
  onSelect: () => void;
  onToggleExpanded: () => void;
  selected: boolean;
}): ReactElement {
  const chipTone = getSessionEventChipTone(event);
  const preview = clipPreview(summarizeSessionEvent(event));

  return (
    <div
      className={cn(
        "border-border-subtle bg-card relative w-full overflow-hidden rounded-md border transition-colors",
        selected && "border-ink-900/35 ring-1 ring-ink-900/35 ring-inset",
      )}
    >
      <button
        type="button"
        onClick={() => {
          onSelect();
          onToggleExpanded();
        }}
        className="grid w-full grid-cols-[16px_136px_minmax(122px,0.45fr)_minmax(0,1fr)_64px_64px_44px_54px] items-center gap-2 px-3 py-2 pl-4 text-left"
      >
        {expanded ? (
          <ChevronDown className="text-fg-3 size-3 shrink-0" />
        ) : (
          <ChevronRight className="text-fg-3 size-3 shrink-0" />
        )}
        <span
          className={cn(
            "inline-flex items-center justify-self-start whitespace-nowrap rounded-sm px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            chipTone.chip,
          )}
        >
          {getSessionEventLabel(event.type)}
        </span>
        <span className="text-fg-1 truncate text-[12.5px] font-semibold">
          {getSessionEventLabel(event.type)}
        </span>
        <span className="text-fg-3 min-w-0 truncate text-[12px]">{preview}</span>
        <span className="text-fg-3 justify-self-end text-[11px] tabular-nums">
          {formatTokens(event.tokens)}
        </span>
        <span className="text-fg-3 justify-self-end text-[11px] tabular-nums">
          {formatDuration(event.durationMs)}
        </span>
        <span className="text-fg-3 justify-self-end font-mono text-[11px] tabular-nums">
          #{index + 1}
        </span>
        <span className="text-fg-3 justify-self-end font-mono text-[11px] tabular-nums">
          {formatOffset(offsetMs)}
        </span>
      </button>

      {expanded ? (
        <div className="border-border-subtle bg-muted/20 border-t px-3 py-2">
          <div className="text-fg-3 text-[10.5px] font-bold tracking-[0.14em] uppercase">
            content
          </div>
          <pre className="text-fg-2 mt-1 max-h-48 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {event.content}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export function SessionTurnDrawer({
  focusEventId,
  onOpenChange,
  open,
  turn,
}: {
  focusEventId: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  turn: SessionTurn | null;
}): ReactElement {
  const events = useMemo(() => turn?.events ?? [], [turn?.events]);
  const visibleEvents = useMemo(() => events.filter(isSessionEventVisibleInMainFeed), [events]);
  const title = turn === null ? "Turn" : `Turn #${turn.index}`;
  const [copied, setCopied] = useState(false);
  const totalDurationMs = visibleEvents.reduce(
    (total, event) => total + (event.durationMs ?? 0),
    0,
  );
  const totalTokens = calculateSessionTurnTokens(events);

  async function copyEvents(): Promise<void> {
    await navigator.clipboard.writeText(
      createSessionEventCopyText({ events: visibleEvents, title }),
    );
    setCopied(true);
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1400);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-[1080px]">
        <DialogHeader className="border-border-subtle border-b px-7 pt-4 pb-3">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-fg-1 text-[14px] font-semibold">{title}</DialogTitle>
                {turn !== null ? (
                  <span
                    className={cn(
                      "rounded-sm border px-1 py-0.5 text-[10.5px] font-semibold",
                      turnStatusClassName(turn.status),
                    )}
                  >
                    {turnStatusLabel(turn.status)}
                  </span>
                ) : null}
              </div>
              <DialogDescription className="text-fg-3 mt-0.5 text-[11.5px] tabular-nums">
                {formatTotalDuration(totalDurationMs)} · {visibleEvents.length} events ·{" "}
                {formatTokens(totalTokens)} tokens
              </DialogDescription>
            </div>
            <Button
              onClick={() => {
                void copyEvents();
              }}
              size="sm"
              variant="outline"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogHeader>

        <SessionEventDrawerCore
          key={`${open}:${turn?.id ?? "none"}`}
          EventComponent={DrawerEventRow}
          emptyState={
            <div className="px-7 py-12 text-center">
              <div className="text-fg-1 text-sm font-semibold">No events recorded</div>
              <div className="text-fg-3 mt-1 text-[12.5px]">This turn has no durable events.</div>
            </div>
          }
          events={visibleEvents}
          focusEventId={focusEventId}
          LegendComponent={SessionEventLegend}
          TimelineComponent={SessionTimeline}
        />
      </DialogContent>
    </Dialog>
  );
}
