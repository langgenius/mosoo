import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { ChevronRight, Clock3 } from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import {
  getSessionEventChipTone,
  getSessionEventDomain,
  getSessionEventLabel,
  getSessionEventStatusLabel,
  isSessionEventVisibleInMainFeed,
  SESSION_EVENT_DOMAIN_LABEL,
  SESSION_EVENT_DOMAIN_TONE,
  SESSION_EVENT_FILTER_DOMAINS,
  summarizeSessionEvent,
} from "./domain";
import {
  clipPreview,
  formatEventTime,
  statusClassName,
  turnStatusClassName,
  turnStatusLabel,
} from "./feed-display";
import { formatTotalDuration } from "./format";
import { calculateSessionTurnDuration, countSessionTurnDomains } from "./turns";
import type { SessionTurn } from "./turns";

function TurnStats({ events }: { events: readonly SessionProcessEvent[] }): ReactElement {
  const counts = countSessionTurnDomains(events);

  return (
    <div className="text-fg-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      {SESSION_EVENT_FILTER_DOMAINS.map((domain) => (
        <span key={domain} className="inline-flex items-center gap-1">
          <span className={cn("size-1.5 rounded-sm", SESSION_EVENT_DOMAIN_TONE[domain].swatch)} />
          {counts[domain]} {SESSION_EVENT_DOMAIN_LABEL[domain]}
        </span>
      ))}
    </div>
  );
}

function SessionEventRow({
  event,
  onOpen,
}: {
  event: SessionProcessEvent;
  onOpen: () => void;
}): ReactElement {
  const domain = getSessionEventDomain(event.type);
  const domainTone = SESSION_EVENT_DOMAIN_TONE[domain];
  const chipTone = getSessionEventChipTone(event);
  const preview = clipPreview(summarizeSessionEvent(event));

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative grid h-11 w-full grid-cols-[136px_minmax(118px,0.55fr)_minmax(0,1.45fr)_76px_82px] items-center gap-2 overflow-hidden rounded-md border border-border-subtle bg-card pr-2 pl-3 text-left transition-colors",
        domainTone.row,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-self-start whitespace-nowrap rounded-sm px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          chipTone.chip,
        )}
      >
        {getSessionEventLabel(event.type)}
      </span>
      <span className="text-fg-1 truncate text-[12px] font-semibold">
        {SESSION_EVENT_DOMAIN_LABEL[domain]}
      </span>
      <span className="text-fg-3 min-w-0 truncate text-[12px]">{preview}</span>
      <span className="text-fg-3 justify-self-end font-mono text-[10.5px] tabular-nums">
        {formatEventTime(event.occurredAt)}
      </span>
      <span
        className={cn(
          "justify-self-end rounded-sm border px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          statusClassName(event.status),
        )}
      >
        {getSessionEventStatusLabel(event.status)}
      </span>
    </button>
  );
}

export function TurnCard({
  collapsed,
  filteredEvents,
  onOpenDrawer,
  onToggleCollapsed,
  turn,
}: {
  collapsed: boolean;
  filteredEvents: SessionProcessEvent[];
  onOpenDrawer: (eventId: string | null) => void;
  onToggleCollapsed: () => void;
  turn: SessionTurn;
}): ReactElement {
  const durationMs = calculateSessionTurnDuration(turn);
  const visible = filteredEvents.length > 0;
  const visibleTurnEventCount = turn.events.filter(isSessionEventVisibleInMainFeed).length;

  return (
    <section className="border-border-subtle overflow-hidden rounded-lg border bg-white">
      <div className="flex items-start justify-between gap-3 px-3.5 py-3">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span className="text-fg-3 mt-0.5 flex size-5 shrink-0 items-center justify-center">
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150 ease-out",
                collapsed ? "rotate-0" : "rotate-90",
              )}
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-fg-1 text-[13px] font-semibold">Turn #{turn.index}</h3>
              <span
                className={cn(
                  "rounded-sm border px-1 py-0.5 text-[10.5px] font-semibold",
                  turnStatusClassName(turn.status),
                )}
              >
                {turnStatusLabel(turn.status)}
              </span>
              <span className="text-fg-3 inline-flex items-center gap-1 text-[11px] tabular-nums">
                <Clock3 className="size-3" />
                {formatTotalDuration(durationMs)}
              </span>
              {!visible ? <span className="text-fg-3 text-[11px]">No matching events</span> : null}
            </div>
            <div className="mt-1">
              <TurnStats events={turn.events} />
            </div>
          </div>
        </button>
        <Button
          onClick={() => {
            onOpenDrawer(null);
          }}
          size="xs"
          variant="outline"
        >
          Open drawer
          <span className="text-fg-3">{visibleTurnEventCount}</span>
        </Button>
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          !collapsed && visible ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div
          aria-hidden={collapsed || !visible}
          className="overflow-hidden"
          inert={collapsed || !visible ? true : undefined}
        >
          <div className="border-border-subtle bg-paper-100 flex flex-col gap-1.5 border-t p-2.5">
            {filteredEvents.map((event) => (
              <SessionEventRow
                key={event.id}
                event={event}
                onOpen={() => {
                  onOpenDrawer(event.id);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
