import { useMemo, useRef, useState } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";

const SESSION_EVENT_DRAWER_ROW_HEIGHT = 70;
const SESSION_EVENT_DRAWER_OVERSCAN = 6;

export interface SessionEventDrawerCoreEvent {
  durationMs: number | null;
  id: string;
  tokens: number | null;
}

interface SessionEventDrawerCoreProps<TEvent extends SessionEventDrawerCoreEvent> {
  emptyState: ReactNode;
  events: readonly TEvent[];
  EventComponent: ComponentType<SessionEventDrawerEventComponentProps<TEvent>>;
  focusEventId?: string | null;
  LegendComponent: ComponentType<SessionEventDrawerLegendComponentProps<TEvent>>;
  TimelineComponent: ComponentType<SessionEventDrawerTimelineComponentProps<TEvent>>;
}

export interface SessionEventDrawerEventComponentProps<TEvent extends SessionEventDrawerCoreEvent> {
  event: TEvent;
  expanded: boolean;
  index: number;
  offsetMs: number;
  onSelect: () => void;
  onToggleExpanded: () => void;
  selected: boolean;
}

export interface SessionEventDrawerLegendComponentProps<
  TEvent extends SessionEventDrawerCoreEvent,
> {
  events: readonly TEvent[];
}

export interface SessionEventDrawerTimelineComponentProps<
  TEvent extends SessionEventDrawerCoreEvent,
> {
  events: readonly TEvent[];
  onSelect: (eventId: string) => void;
  selectedId: string | null;
}

interface EventOffsets {
  offsets: number[];
  totalHeight: number;
}

function createEventOffsets(input: {
  events: readonly SessionEventDrawerCoreEvent[];
  expandedEventIds: ReadonlySet<string>;
}): EventOffsets {
  const offsets: number[] = [];
  let currentOffset = 0;

  for (const event of input.events) {
    offsets.push(currentOffset);
    currentOffset += input.expandedEventIds.has(event.id) ? 210 : SESSION_EVENT_DRAWER_ROW_HEIGHT;
  }

  return {
    offsets,
    totalHeight: currentOffset,
  };
}

function findStartIndex(offsets: readonly number[], scrollTop: number): number {
  const firstVisible = offsets.findIndex((offset, index) => {
    const nextOffset = offsets[index + 1] ?? Number.POSITIVE_INFINITY;
    return nextOffset >= scrollTop && offset <= scrollTop;
  });

  return Math.max(0, firstVisible === -1 ? 0 : firstVisible - SESSION_EVENT_DRAWER_OVERSCAN);
}

function calculateCumulativeOffsetsMs(events: readonly SessionEventDrawerCoreEvent[]): number[] {
  const result: number[] = [];
  let running = 0;

  for (const event of events) {
    result.push(running);
    running += event.durationMs ?? 0;
  }

  return result;
}

export function SessionEventDrawerCore<TEvent extends SessionEventDrawerCoreEvent>({
  emptyState,
  events,
  EventComponent,
  focusEventId = null,
  LegendComponent,
  TimelineComponent,
}: SessionEventDrawerCoreProps<TEvent>): ReactElement {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(() => new Set());
  const [expansionTouched, setExpansionTouched] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const eventRefs = useRef<Map<string, HTMLDivElement> | null>(null);
  eventRefs.current ??= new Map<string, HTMLDivElement>();
  const eventRefMap = eventRefs.current;
  const listRef = useRef<HTMLDivElement | null>(null);
  const initialScrollCompletedRef = useRef(false);
  const selectedId = selectedEventId ?? focusEventId ?? events[0]?.id ?? null;
  const virtualized = events.length > 200;
  const expandedReadonly = useMemo(() => {
    const next = new Set(expandedEventIds);

    if (!expansionTouched && selectedId !== null) {
      next.add(selectedId);
    }

    return next;
  }, [expandedEventIds, expansionTouched, selectedId]);
  const { offsets, totalHeight } = useMemo(
    () => createEventOffsets({ events, expandedEventIds: expandedReadonly }),
    [events, expandedReadonly],
  );
  const cumulativeOffsetsMs = useMemo(() => calculateCumulativeOffsetsMs(events), [events]);
  const visibleRange = useMemo(() => {
    if (!virtualized) {
      return { end: events.length, start: 0 };
    }

    const start = findStartIndex(offsets, scrollTop);
    const viewportHeight = listRef.current?.clientHeight ?? 420;
    const end = Math.min(
      events.length,
      start +
        Math.ceil(viewportHeight / SESSION_EVENT_DRAWER_ROW_HEIGHT) +
        SESSION_EVENT_DRAWER_OVERSCAN * 2,
    );

    return { end, start };
  }, [events.length, offsets, scrollTop, virtualized]);

  function scrollInitialSelection(): void {
    if (initialScrollCompletedRef.current || selectedId === null) {
      return;
    }

    const index = events.findIndex((event) => event.id === selectedId);
    const offset = index === -1 ? null : offsets[index];

    if (offset !== null && offset !== undefined && listRef.current !== null) {
      initialScrollCompletedRef.current = true;
      globalThis.requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: offset });
        eventRefMap.get(selectedId)?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  function selectEvent(eventId: string): void {
    setSelectedEventId(eventId);

    if (virtualized) {
      const index = events.findIndex((event) => event.id === eventId);
      const offset = index === -1 ? null : offsets[index];

      if (offset !== null && offset !== undefined) {
        listRef.current?.scrollTo({ behavior: "smooth", top: offset });
      }

      return;
    }

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
        <TimelineComponent events={events} onSelect={selectEvent} selectedId={selectedId} />
      </div>
      <div className="min-w-0 shrink-0">
        <LegendComponent events={events} />
      </div>
      <div
        ref={(node) => {
          listRef.current = node;
          if (node !== null) {
            scrollInitialSelection();
          }
        }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        {virtualized ? (
          <div className="relative" style={{ height: totalHeight }}>
            {events.slice(visibleRange.start, visibleRange.end).map((event, offsetIndex) => {
              const eventIndex = visibleRange.start + offsetIndex;
              const top = offsets[eventIndex] ?? 0;

              return (
                <div key={event.id} className="absolute right-0 left-0 px-0.5" style={{ top }}>
                  <EventComponent
                    event={event}
                    expanded={expandedReadonly.has(event.id)}
                    index={eventIndex}
                    offsetMs={cumulativeOffsetsMs[eventIndex] ?? 0}
                    onSelect={() => {
                      selectEvent(event.id);
                    }}
                    onToggleExpanded={() => {
                      toggleExpanded(event.id);
                    }}
                    selected={selectedId === event.id}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {events.map((event, index) => (
              <div
                key={event.id}
                ref={(node) => {
                  if (node) {
                    eventRefMap.set(event.id, node);
                    if (event.id === selectedId) {
                      scrollInitialSelection();
                    }
                  } else {
                    eventRefMap.delete(event.id);
                  }
                }}
              >
                <EventComponent
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
        )}
      </div>
    </div>
  );
}
