import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";

import { fetchAgentRuntimeEvents } from "@/domains/session/api/agent-runtime-events";
import type { AgentRuntimeEvent } from "@/domains/session/api/agent-runtime-events";
import type { AgentRuntimeEventFamily } from "@/gql/graphql";
import { toAgentId } from "@/routes/typed-id";

import {
  SYSTEM_LOG_BOTTOM_STICKY_THRESHOLD_PX,
  SYSTEM_LOG_PAGE_SIZE,
  SYSTEM_LOG_POLLING_INTERVAL_MS,
  SYSTEM_LOG_RUNTIME_EVENT_FAMILIES,
  mergeRuntimeEvents,
} from "./system-log-model";
import type { SystemLogPagination } from "./system-log-model";

export interface SystemLogFeedState {
  readonly displayEvents: AgentRuntimeEvent[];
  readonly empty: boolean;
  readonly eventCount: number;
  readonly initialLoadFailed: boolean;
  readonly isFetching: boolean;
  readonly isLoading: boolean;
  readonly isSticky: boolean;
  readonly lastRefreshedAt: number | null;
  readonly liveErrorMessage: string;
  readonly liveTailPaused: boolean;
  readonly loadOlderError: string | null;
  readonly loadingOlder: boolean;
  readonly newEventCount: number;
  readonly pagination: SystemLogPagination;
  readonly searchingOlder: boolean;
  readonly selectedFamilySet: ReadonlySet<AgentRuntimeEventFamily>;
  loadOlder(): Promise<void>;
  refreshLatest(): void;
  resetFamilyFilter(): void;
  scrollToBottom(): void;
  setOlderSearchNode(node: HTMLDivElement | null): void;
  setScrollContainerNode(node: HTMLDivElement | null): void;
  setScrollContentNode(node: HTMLDivElement | null): void;
  toggleFamily(family: AgentRuntimeEventFamily): void;
  trackScroll(event: UIEvent<HTMLDivElement>): void;
}

interface SystemLogFeedRuntimeState {
  readonly isSticky: boolean;
  readonly loadOlderError: string | null;
  readonly loadingOlder: boolean;
  readonly olderEvents: AgentRuntimeEvent[];
  readonly olderPagination: SystemLogPagination | null;
  readonly pausedAtEventId: string | null;
  readonly scope: string;
}

function createSystemLogFeedRuntimeState(scope: string): SystemLogFeedRuntimeState {
  return {
    isSticky: true,
    loadOlderError: null,
    loadingOlder: false,
    olderEvents: [],
    olderPagination: null,
    pausedAtEventId: null,
    scope,
  };
}

function countEventsAfter(events: AgentRuntimeEvent[], eventId: string | null): number {
  if (eventId === null) {
    return 0;
  }

  const index = events.findIndex((event) => event.id === eventId);

  return index === -1 ? events.length : index;
}

function getRuntimeStateForScope(
  current: SystemLogFeedRuntimeState,
  scope: string,
): SystemLogFeedRuntimeState {
  return current.scope === scope ? current : createSystemLogFeedRuntimeState(scope);
}

export function useSystemLogFeed(agentId: string): SystemLogFeedState {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const restoreScrollHeightRef = useRef<number | null>(null);
  const eventsRef = useRef<AgentRuntimeEvent[]>([]);
  const olderSearchRequestRef = useRef<string | null>(null);
  const [selectedFamilySet, setSelectedFamilySet] = useState<Set<AgentRuntimeEventFamily>>(
    () => new Set(SYSTEM_LOG_RUNTIME_EVENT_FAMILIES),
  );
  const selectedFamilies = useMemo(
    () => SYSTEM_LOG_RUNTIME_EVENT_FAMILIES.filter((family) => selectedFamilySet.has(family)),
    [selectedFamilySet],
  );
  const selectedFamilyKey = selectedFamilies.join(",");
  const feedScope = `${agentId}:${selectedFamilyKey}`;
  const feedScopeRef = useRef(feedScope);
  const [runtimeState, setRuntimeState] = useState<SystemLogFeedRuntimeState>(() =>
    createSystemLogFeedRuntimeState(feedScope),
  );

  const scopedRuntimeState = getRuntimeStateForScope(runtimeState, feedScope);

  if (feedScopeRef.current !== feedScope) {
    feedScopeRef.current = feedScope;
    restoreScrollHeightRef.current = null;
    stickToBottomRef.current = true;
  }

  stickToBottomRef.current = scopedRuntimeState.isSticky;

  const liveQuery = useQuery({
    queryFn: async () =>
      fetchAgentRuntimeEvents({
        agentId: toAgentId(agentId),
        families: selectedFamilies,
        limit: SYSTEM_LOG_PAGE_SIZE,
      }),
    queryKey: ["agent-runtime-events", agentId, "latest", selectedFamilyKey],
    refetchInterval: SYSTEM_LOG_POLLING_INTERVAL_MS,
  });

  const events = useMemo(
    () => mergeRuntimeEvents(scopedRuntimeState.olderEvents, liveQuery.data?.nodes ?? []),
    [liveQuery.data?.nodes, scopedRuntimeState.olderEvents],
  );
  const pagination = scopedRuntimeState.olderPagination ?? {
    hasMoreOlder: liveQuery.data?.pageInfo.hasMore ?? false,
    olderCursor: liveQuery.data?.pageInfo.endCursor ?? null,
  };
  const isSticky = scopedRuntimeState.isSticky;
  const loadingOlder = scopedRuntimeState.loadingOlder;
  const loadOlderError = scopedRuntimeState.loadOlderError;
  const newEventCount = isSticky ? 0 : countEventsAfter(events, scopedRuntimeState.pausedAtEventId);
  const eventsVersion = `${events.length}:${events[0]?.id ?? ""}:${events.at(-1)?.id ?? ""}`;

  eventsRef.current = events;

  const adjustScrollPosition = useCallback(() => {
    void eventsVersion;

    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    if (restoreScrollHeightRef.current !== null) {
      const previousHeight = restoreScrollHeightRef.current;
      restoreScrollHeightRef.current = null;
      container.scrollTop += container.scrollHeight - previousHeight;
      return;
    }

    if (isSticky) {
      container.scrollTop = container.scrollHeight;
    }
  }, [eventsVersion, isSticky]);

  const setScrollContainerNode = useCallback(
    (node: HTMLDivElement | null): void => {
      scrollContainerRef.current = node;

      if (node !== null) {
        adjustScrollPosition();
      }
    },
    [adjustScrollPosition],
  );

  const setScrollContentNode = useCallback(
    (node: HTMLDivElement | null): void => {
      if (node !== null) {
        adjustScrollPosition();
      }
    },
    [adjustScrollPosition],
  );

  const displayEvents = useMemo(() => events.toReversed(), [events]);

  const trackScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

      if (distanceToBottom <= SYSTEM_LOG_BOTTOM_STICKY_THRESHOLD_PX) {
        setRuntimeState((current) => ({
          ...getRuntimeStateForScope(current, feedScope),
          isSticky: true,
          pausedAtEventId: null,
        }));
        return;
      }

      if (distanceToBottom >= target.clientHeight) {
        setRuntimeState((current) => {
          const scoped = getRuntimeStateForScope(current, feedScope);

          return scoped.isSticky
            ? { ...scoped, isSticky: false, pausedAtEventId: eventsRef.current[0]?.id ?? null }
            : scoped;
        });
      }
    },
    [feedScope],
  );

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    setRuntimeState((current) => ({
      ...getRuntimeStateForScope(current, feedScope),
      isSticky: true,
      pausedAtEventId: null,
    }));
    container.scrollTo({ behavior: "smooth", top: container.scrollHeight });
  }, [feedScope]);

  const loadOlder = useCallback(async () => {
    const currentPagination = scopedRuntimeState.olderPagination ?? {
      hasMoreOlder: liveQuery.data?.pageInfo.hasMore ?? false,
      olderCursor: liveQuery.data?.pageInfo.endCursor ?? null,
    };

    if (!currentPagination.olderCursor || scopedRuntimeState.loadingOlder) {
      return;
    }

    const requestScope = feedScopeRef.current;
    const container = scrollContainerRef.current;
    restoreScrollHeightRef.current = container?.scrollHeight ?? null;
    setRuntimeState((current) => ({
      ...getRuntimeStateForScope(current, requestScope),
      loadingOlder: true,
      loadOlderError: null,
    }));

    try {
      const page = await fetchAgentRuntimeEvents({
        agentId: toAgentId(agentId),
        beforeCursor: currentPagination.olderCursor,
        families: selectedFamilies,
        limit: SYSTEM_LOG_PAGE_SIZE,
      });

      if (feedScopeRef.current === requestScope) {
        setRuntimeState((current) => {
          const scoped = getRuntimeStateForScope(current, requestScope);

          return {
            ...scoped,
            loadOlderError: null,
            olderEvents: mergeRuntimeEvents(scoped.olderEvents, page.nodes),
            olderPagination: {
              hasMoreOlder: page.pageInfo.hasMore,
              olderCursor: page.pageInfo.endCursor,
            },
          };
        });
      }
    } catch (error) {
      if (feedScopeRef.current === requestScope) {
        restoreScrollHeightRef.current = null;
        setRuntimeState((current) => ({
          ...getRuntimeStateForScope(current, requestScope),
          loadOlderError: error instanceof Error ? error.message : "Failed to load older events.",
        }));
      }
    } finally {
      setRuntimeState((current) =>
        current.scope === requestScope ? { ...current, loadingOlder: false } : current,
      );
    }
  }, [
    agentId,
    liveQuery.data?.pageInfo.endCursor,
    liveQuery.data?.pageInfo.hasMore,
    scopedRuntimeState.loadingOlder,
    scopedRuntimeState.olderPagination,
    selectedFamilies,
  ]);

  const resetFamilyFilter = useCallback(() => {
    setSelectedFamilySet(new Set(SYSTEM_LOG_RUNTIME_EVENT_FAMILIES));
  }, []);

  const toggleFamily = useCallback((family: AgentRuntimeEventFamily) => {
    setSelectedFamilySet((current) => {
      const next = new Set(current);

      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }

      return next;
    });
  }, []);

  const liveTailPaused = liveQuery.isError && events.length > 0;
  const initialLoadFailed = liveQuery.isError && events.length === 0;
  const liveErrorMessage =
    liveQuery.error instanceof Error ? liveQuery.error.message : "Failed to load system events.";
  const searchingOlder =
    !liveQuery.isLoading &&
    !initialLoadFailed &&
    events.length === 0 &&
    pagination.hasMoreOlder &&
    pagination.olderCursor !== null;
  const empty =
    !liveQuery.isLoading && !initialLoadFailed && events.length === 0 && !pagination.hasMoreOlder;
  const lastRefreshedAt = liveQuery.dataUpdatedAt > 0 ? liveQuery.dataUpdatedAt : null;

  const setOlderSearchNode = useCallback(
    (node: HTMLDivElement | null): void => {
      const cursor = pagination.olderCursor;

      if (
        node !== null &&
        searchingOlder &&
        !loadingOlder &&
        !loadOlderError &&
        cursor !== null &&
        olderSearchRequestRef.current !== cursor
      ) {
        olderSearchRequestRef.current = cursor;
        void loadOlder();
      }
    },
    [loadOlder, loadOlderError, loadingOlder, pagination.olderCursor, searchingOlder],
  );

  return {
    displayEvents,
    empty,
    eventCount: events.length,
    initialLoadFailed,
    isFetching: liveQuery.isFetching,
    isLoading: liveQuery.isLoading,
    isSticky,
    lastRefreshedAt,
    liveErrorMessage,
    liveTailPaused,
    loadOlderError,
    loadingOlder,
    newEventCount,
    pagination,
    searchingOlder,
    selectedFamilySet,
    loadOlder,
    refreshLatest: () => {
      void liveQuery.refetch();
    },
    resetFamilyFilter,
    scrollToBottom,
    setOlderSearchNode,
    setScrollContainerNode,
    setScrollContentNode,
    toggleFamily,
    trackScroll,
  };
}
