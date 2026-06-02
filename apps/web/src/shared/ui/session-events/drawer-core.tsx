import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

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
  focusEventId?: string | null;
  renderEvent: (input: {
    event: TEvent;
    expanded: boolean;
    index: number;
    offsetMs: number;
    onSelect: () => void;
    onToggleExpanded: () => void;
    selected: boolean;
  }) => ReactNode;
  renderLegend: () => ReactNode;
  renderTimeline: (input: {
    onSelect: (eventId: string) => void;
    selectedId: string | null;
  }) => ReactNode;
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
  focusEventId = null,
  renderEvent,
  renderLegend,
  renderTimeline,
}: SessionEventDrawerCoreProps<TEvent>): ReactElement {
  const initialEventsRef = useRef(events);
  const initialFocusRef = useRef(focusEventId);
  const initialSelectedId = initialFocusRef.current ?? initialEventsRef.current[0]?.id ?? null;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialSelectedId);
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(() =>
    initialSelectedId === null ? new Set<string>() : new Set([initialSelectedId]),
  );
  const [scrollTop, setScrollTop] = useState(0);
  const eventRefs = useRef(new Map<string, HTMLDivElement>());
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedId = selectedEventId;
  const virtualized = events.length > 200;
  const expandedReadonly = useMemo(() => new Set(expandedEventIds), [expandedEventIds]);
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

  useEffect(() => {
    if (initialSelectedId === null) {
      return;
    }

    const initialEvents = initialEventsRef.current;
    const index = initialEvents.findIndex((event) => event.id === initialSelectedId);
    const initialOffsets = createEventOffsets({
      events: initialEvents,
      expandedEventIds: new Set([initialSelectedId]),
    }).offsets;
    const offset = index === -1 ? null : initialOffsets[index];

    if (offset !== null && offset !== undefined) {
      window.requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: offset });
        eventRefs.current.get(initialSelectedId)?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [initialSelectedId]);

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

    eventRefs.current.get(eventId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function toggleExpanded(eventId: string): void {
    setExpandedEventIds((current) => {
      const next = new Set(current);

      if (next.has(eventId)) {
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
    <div className="flex min-h-0 flex-col gap-3 px-7 py-4">
      {renderTimeline({ onSelect: selectEvent, selectedId })}
      {renderLegend()}
      <div
        ref={listRef}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
        className="h-[420px] min-h-0 overflow-y-auto pr-1"
      >
        {virtualized ? (
          <div className="relative" style={{ height: totalHeight }}>
            {events.slice(visibleRange.start, visibleRange.end).map((event, offsetIndex) => {
              const eventIndex = visibleRange.start + offsetIndex;
              const top = offsets[eventIndex] ?? 0;

              return (
                <div key={event.id} className="absolute right-0 left-0 px-0.5" style={{ top }}>
                  {renderEvent({
                    event,
                    expanded: expandedEventIds.has(event.id),
                    index: eventIndex,
                    offsetMs: cumulativeOffsetsMs[eventIndex] ?? 0,
                    onSelect: () => {
                      selectEvent(event.id);
                    },
                    onToggleExpanded: () => {
                      toggleExpanded(event.id);
                    },
                    selected: selectedId === event.id,
                  })}
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
                    eventRefs.current.set(event.id, node);
                  } else {
                    eventRefs.current.delete(event.id);
                  }
                }}
              >
                {renderEvent({
                  event,
                  expanded: expandedEventIds.has(event.id),
                  index,
                  offsetMs: cumulativeOffsetsMs[index] ?? 0,
                  onSelect: () => {
                    selectEvent(event.id);
                  },
                  onToggleExpanded: () => {
                    toggleExpanded(event.id);
                  },
                  selected: selectedId === event.id,
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
