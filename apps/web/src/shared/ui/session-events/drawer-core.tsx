import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { ChevronRight } from "@/shared/ui/icons";

import {
  getSessionEventChipTone,
  getSessionEventDomain,
  getSessionEventDomainLabel,
  getSessionEventLabel,
  isSessionEventAttentionWorthy,
  SESSION_EVENT_DOMAIN_TONE,
  SESSION_EVENT_FILTER_DOMAINS,
  summarizeSessionEvent,
} from "./domain";
import { clipPreview } from "./feed-display";
import { formatDuration, formatOffset, formatTokens, formatTotalDuration } from "./format";
import { countSessionTurnDomains } from "./turns";

function SessionTimelineBar({
  events,
  onSelect,
  selectedId,
}: {
  events: readonly SessionProcessEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="border-border-soft bg-sunken/10 flex h-7 w-full max-w-full min-w-0 items-center gap-0.5 overflow-hidden rounded-md border p-1">
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
            aria-label={t("sessionEvents.selectEvent", {
              label: getSessionEventLabel(event.type, t),
            })}
            style={{ flexGrow: Math.max(event.durationMs ?? 1, 1) }}
            className={cn(
              "h-full min-w-[2px] rounded-[1px] border text-[0] transition-colors",
              attention ? "border-danger/40 bg-danger/40" : cn("border-transparent", tone.bar),
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
  const { t } = useTranslation();
  const counts = countSessionTurnDomains(events);

  return (
    <div className="text-fg-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
      {SESSION_EVENT_FILTER_DOMAINS.map((domain) => (
        <span key={domain} className="inline-flex items-center gap-1">
          <span className={cn("size-2 rounded-sm", SESSION_EVENT_DOMAIN_TONE[domain].swatch)} />
          <span>
            {getSessionEventDomainLabel(domain, t)} {counts[domain]}
          </span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="border-danger/40 bg-danger/40 size-2 rounded-sm border" />
        <span>{t("common.error")}</span>
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
  const { t } = useTranslation();
  const chipTone = getSessionEventChipTone(event);
  const preview = clipPreview(summarizeSessionEvent(event, t));

  return (
    <div
      className={cn(
        "border-border-soft bg-card relative w-full overflow-hidden rounded-md border transition-colors",
        selected && "border-emphasis/35 ring-1 ring-emphasis/35 ring-inset",
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
        <ChevronRight
          className={cn(
            "text-fg-3 size-3 shrink-0 transition-transform duration-150 ease-out",
            expanded ? "rotate-90" : "rotate-0",
          )}
        />
        <span
          className={cn(
            "inline-flex items-center justify-self-start whitespace-nowrap rounded-sm px-1 py-0.5 text-[10px] font-semibold",
            chipTone.chip,
          )}
        >
          {getSessionEventLabel(event.type, t)}
        </span>
        <span className="text-fg-1 truncate text-[12.5px] font-semibold">
          {getSessionEventLabel(event.type, t)}
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
        <div className="grid grid-rows-[1fr] transition-[grid-template-rows] duration-200 ease-out starting:grid-rows-[0fr]">
          <div className="overflow-hidden">
            <div className="border-border-soft bg-sunken/20 border-t px-3 py-2">
              <div className="t-group-label">{t("sessionEvents.content")}</div>
              <pre className="text-fg-2 mt-1 max-h-48 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {event.content}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function calculateCumulativeOffsetsMs(events: readonly SessionProcessEvent[]): number[] {
  const result: number[] = [];
  let running = 0;

  for (const event of events) {
    result.push(running);
    running += event.durationMs ?? 0;
  }

  return result;
}

export function SessionEventDrawerCore({
  emptyState,
  events,
  focusEventId = null,
}: {
  emptyState: ReactNode;
  events: readonly SessionProcessEvent[];
  focusEventId?: string | null;
}): ReactElement {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(() => new Set());
  const [expansionTouched, setExpansionTouched] = useState(false);
  const eventRefs = useRef<Map<string, HTMLDivElement> | null>(null);
  eventRefs.current ??= new Map<string, HTMLDivElement>();
  const eventRefMap = eventRefs.current;
  const initialScrollCompletedRef = useRef(false);
  const selectedId = selectedEventId ?? focusEventId ?? events[0]?.id ?? null;
  const expandedReadonly = useMemo(() => {
    const next = new Set(expandedEventIds);

    if (!expansionTouched && selectedId !== null) {
      next.add(selectedId);
    }

    return next;
  }, [expandedEventIds, expansionTouched, selectedId]);
  const cumulativeOffsetsMs = useMemo(() => calculateCumulativeOffsetsMs(events), [events]);

  function selectEvent(eventId: string): void {
    setSelectedEventId(eventId);
    eventRefMap.get(eventId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function toggleExpanded(eventId: string): void {
    setExpansionTouched(true);
    setExpandedEventIds((current) => {
      const next = new Set(current);

      if (expandedReadonly.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }

      return next;
    });
  }

  if (events.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden px-7 py-4">
      <div className="min-w-0 shrink-0">
        <SessionTimeline events={events} onSelect={selectEvent} selectedId={selectedId} />
      </div>
      <div className="min-w-0 shrink-0">
        <SessionEventLegend events={events} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1.5">
          {events.map((event, index) => (
            <div
              key={event.id}
              ref={(node) => {
                if (node === null) {
                  eventRefMap.delete(event.id);
                  return;
                }

                eventRefMap.set(event.id, node);

                if (event.id === selectedId && !initialScrollCompletedRef.current) {
                  initialScrollCompletedRef.current = true;
                  globalThis.requestAnimationFrame(() => {
                    node.scrollIntoView({ block: "start" });
                  });
                }
              }}
            >
              <DrawerEventRow
                event={event}
                expanded={expandedReadonly.has(event.id)}
                index={index}
                offsetMs={cumulativeOffsetsMs[index] ?? 0}
                onSelect={() => {
                  selectEvent(event.id);
                }}
                onToggleExpanded={() => {
                  toggleExpanded(event.id);
                }}
                selected={selectedId === event.id}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
