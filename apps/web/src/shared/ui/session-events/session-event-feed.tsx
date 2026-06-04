import type { SessionProcessEvent } from "@mosoo/contracts/session";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { ScrollArea } from "@/shared/ui/scroll-area";

import {
  isSessionEventVisibleInMainFeed,
  isSyntheticNoRuntimeEventsEvent,
  SESSION_EVENT_FILTER_DOMAINS,
} from "./domain";
import type { SessionEventDomain } from "./domain";
import { DomainFilterBar } from "./domain-filter-bar";
import { EmptyFeedState } from "./empty-feed-state";
import { TurnCard } from "./feed-turn-card";
import { SessionTurnDrawer } from "./feed-turn-drawer";
import { FilterEmptyState } from "./filter-empty-state";
import { filterSessionTurnEvents, useSessionTurns } from "./turns";

interface SessionEventFeedProps {
  events: SessionProcessEvent[];
}

interface DrawerState {
  eventId: string | null;
  turnId: string;
}

export function SessionEventFeed({ events }: SessionEventFeedProps): ReactElement {
  const visibleSourceEvents = useMemo(
    () => events.filter((event) => !isSyntheticNoRuntimeEventsEvent(event)),
    [events],
  );
  const mainFeedEvents = useMemo(
    () => visibleSourceEvents.filter(isSessionEventVisibleInMainFeed),
    [visibleSourceEvents],
  );
  const turns = useSessionTurns(visibleSourceEvents);
  const [activeDomains, setActiveDomains] = useState<Set<SessionEventDomain>>(
    () => new Set(SESSION_EVENT_FILTER_DOMAINS),
  );
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [collapsedTurnIds, setCollapsedTurnIds] = useState<Set<string>>(() => new Set());
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const drawerTurn = turns.find((turn) => turn.id === drawerState?.turnId) ?? null;
  const filteredTurns = useMemo(
    () =>
      turns.map((turn) => ({
        filteredEvents: filterSessionTurnEvents({
          domains: activeDomains,
          errorsOnly,
          events: turn.events,
        }),
        turn,
      })),
    [activeDomains, errorsOnly, turns],
  );
  const totalEventCount = mainFeedEvents.length;
  const visibleEventCount = filteredTurns.reduce(
    (total, entry) => total + entry.filteredEvents.length,
    0,
  );

  function resetFilters(): void {
    setActiveDomains(new Set(SESSION_EVENT_FILTER_DOMAINS));
    setErrorsOnly(false);
  }

  function toggleDomain(domain: SessionEventDomain): void {
    setActiveDomains((current) => {
      const next = new Set(current);

      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }

      return next;
    });
  }

  function toggleTurnCollapsed(turnId: string): void {
    setCollapsedTurnIds((current) => {
      const next = new Set(current);

      if (next.has(turnId)) {
        next.delete(turnId);
      } else {
        next.add(turnId);
      }

      return next;
    });
  }

  if (mainFeedEvents.length === 0) {
    return (
      <ScrollArea className="h-full min-h-0 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <EmptyFeedState />
      </ScrollArea>
    );
  }

  return (
    <div className="bg-paper-200 flex h-full min-h-0 flex-col">
      <DomainFilterBar
        domains={activeDomains}
        errorsOnly={errorsOnly}
        onReset={resetFilters}
        onToggleDomain={toggleDomain}
        onToggleErrorsOnly={() => {
          setErrorsOnly((value) => !value);
        }}
        totalCount={totalEventCount}
        visibleCount={visibleEventCount}
      />
      <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4">
          {visibleEventCount === 0 ? (
            <FilterEmptyState onReset={resetFilters} />
          ) : (
            filteredTurns.map(({ filteredEvents, turn }) => (
              <TurnCard
                key={turn.id}
                collapsed={collapsedTurnIds.has(turn.id) || filteredEvents.length === 0}
                filteredEvents={filteredEvents}
                onOpenDrawer={(eventId) => {
                  setDrawerState({ eventId, turnId: turn.id });
                }}
                onToggleCollapsed={() => {
                  toggleTurnCollapsed(turn.id);
                }}
                turn={turn}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <SessionTurnDrawer
        focusEventId={drawerState?.eventId ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerState(null);
          }
        }}
        open={drawerState !== null}
        turn={drawerTurn}
      />
    </div>
  );
}
