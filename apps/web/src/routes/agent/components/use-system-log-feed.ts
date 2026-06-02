import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, UIEvent } from "react";

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
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
  readonly searchingOlder: boolean;
  readonly selectedFamilySet: ReadonlySet<AgentRuntimeEventFamily>;
  loadOlder(): Promise<void>;
  refreshLatest(): void;
  resetFamilyFilter(): void;
  scrollToBottom(): void;
  toggleFamily(family: AgentRuntimeEventFamily): void;
  trackScroll(event: UIEvent<HTMLDivElement>): void;
}

export function useSystemLogFeed(agentId: string): SystemLogFeedState {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const restoreScrollHeightRef = useRef<number | null>(null);
  const eventsRef = useRef<AgentRuntimeEvent[]>([]);
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [pagination, setPagination] = useState<SystemLogPagination>({
    hasMoreOlder: false,
    olderCursor: null,
  });
  const [isSticky, setIsSticky] = useState(true);
  const [newEventCount, setNewEventCount] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState<string | null>(null);
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

  eventsRef.current = events;

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

  useEffect(() => {
    feedScopeRef.current = feedScope;
    eventsRef.current = [];
    restoreScrollHeightRef.current = null;
    stickToBottomRef.current = true;
    setEvents([]);
    setPagination({ hasMoreOlder: false, olderCursor: null });
    setIsSticky(true);
    setNewEventCount(0);
    setLoadingOlder(false);
    setLoadOlderError(null);
  }, [feedScope]);

  useEffect(() => {
    stickToBottomRef.current = isSticky;
  }, [isSticky]);

  useEffect(() => {
    const page = liveQuery.data;

    if (!page) {
      return;
    }

    const currentEvents = eventsRef.current;
    const isInitialPage = currentEvents.length === 0;
    const currentIds = new Set(currentEvents.map((event) => event.id));
    const incomingNewEvents = page.nodes.filter((event) => !currentIds.has(event.id));

    if (!isInitialPage && incomingNewEvents.length === 0) {
      setLoadOlderError(null);
      return;
    }

    setEvents(mergeRuntimeEvents(currentEvents, page.nodes));
    setLoadOlderError(null);

    if (isInitialPage) {
      setPagination({
        hasMoreOlder: page.pageInfo.hasMore,
        olderCursor: page.pageInfo.endCursor,
      });
    } else if (!stickToBottomRef.current) {
      setNewEventCount((count) => count + incomingNewEvents.length);
    }
  }, [liveQuery.data, liveQuery.dataUpdatedAt]);

  useEffect(() => {
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
  }, [events, isSticky]);

  const displayEvents = useMemo(() => events.toReversed(), [events]);

  const trackScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    if (distanceToBottom <= SYSTEM_LOG_BOTTOM_STICKY_THRESHOLD_PX) {
      setIsSticky(true);
      setNewEventCount(0);
      return;
    }

    if (distanceToBottom >= target.clientHeight) {
      setIsSticky(false);
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    setIsSticky(true);
    setNewEventCount(0);
    container.scrollTo({ behavior: "smooth", top: container.scrollHeight });
  }, []);

  const loadOlder = useCallback(async () => {
    if (!pagination.olderCursor || loadingOlder) {
      return;
    }

    const requestScope = feedScopeRef.current;
    const container = scrollContainerRef.current;
    restoreScrollHeightRef.current = container?.scrollHeight ?? null;
    setLoadingOlder(true);
    setLoadOlderError(null);

    try {
      const page = await fetchAgentRuntimeEvents({
        agentId: toAgentId(agentId),
        beforeCursor: pagination.olderCursor,
        families: selectedFamilies,
        limit: SYSTEM_LOG_PAGE_SIZE,
      });

      if (feedScopeRef.current !== requestScope) {
        return;
      }

      setEvents((currentEvents) => mergeRuntimeEvents(currentEvents, page.nodes));
      setPagination({
        hasMoreOlder: page.pageInfo.hasMore,
        olderCursor: page.pageInfo.endCursor,
      });
    } catch (error) {
      if (feedScopeRef.current !== requestScope) {
        return;
      }

      restoreScrollHeightRef.current = null;
      setLoadOlderError(error instanceof Error ? error.message : "Failed to load older events.");
    } finally {
      if (feedScopeRef.current === requestScope) {
        setLoadingOlder(false);
      }
    }
  }, [agentId, loadingOlder, pagination.olderCursor, selectedFamilies]);

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

  useEffect(() => {
    if (searchingOlder && !loadingOlder && !loadOlderError) {
      void loadOlder();
    }
  }, [loadOlder, loadOlderError, loadingOlder, searchingOlder]);

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
    scrollContainerRef,
    searchingOlder,
    selectedFamilySet,
    loadOlder,
    refreshLatest: () => {
      void liveQuery.refetch();
    },
    resetFamilyFilter,
    scrollToBottom,
    toggleFamily,
    trackScroll,
  };
}
