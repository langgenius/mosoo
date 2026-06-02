import type { AgentSummary } from "@mosoo/contracts/agent";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { getThreadSessionMessages } from "@/domains/session/api/agent-session";
import { retrieveThreadAgentSession } from "@/domains/session/api/agent-session-retrieve";
import { archivedThreadSessions, threadSessions } from "@/domains/session/api/list";
import {
  getSessionProcessEvents,
  listSessionThreadUiStates,
} from "@/domains/session/api/thread-projections";
import { toOrganizationId, toSessionId } from "@/routes/typed-id";

import { threadKeys } from "./query-keys";
import {
  compareThreads,
  getThreadSection,
  isThreadWorking,
  matchesThreadFilter,
  summarizeThreads,
  toThreadListItem,
} from "./thread";
import type { ThreadFilter, ThreadListItem, ThreadSection } from "./thread";

function toThreadUiSnapshot(
  states: Awaited<ReturnType<typeof listSessionThreadUiStates>> | undefined,
) {
  const pinnedThreadIds = new Set<string>();
  const readAtByThreadId: Record<string, string> = {};

  for (const state of states ?? []) {
    if (state.pinned) {
      pinnedThreadIds.add(state.sessionId);
    }

    if (state.readAt !== null) {
      readAtByThreadId[state.sessionId] = state.readAt;
    }
  }

  return { pinnedThreadIds, readAtByThreadId };
}

export function useThreadQueries({
  activeOrganizationId,
  activeThreadId,
  filter,
}: {
  activeOrganizationId: string | null;
  activeThreadId: string | null;
  filter: ThreadFilter;
}) {
  const agentsQuery = useVisibleAgentsQuery(activeOrganizationId);
  const activeSessionsQuery = useQuery({
    enabled: activeOrganizationId !== null,
    queryFn: async () => {
      if (activeOrganizationId === null) {
        throw new Error("Organization id is required to list threads.");
      }

      return threadSessions(toOrganizationId(activeOrganizationId), "ui");
    },
    queryKey: threadKeys.list(activeOrganizationId),
    refetchInterval: 10_000,
  });
  const archivedSessionsQuery = useQuery({
    enabled: activeOrganizationId !== null,
    queryFn: async () => {
      if (activeOrganizationId === null) {
        throw new Error("Organization id is required to list archived threads.");
      }

      return archivedThreadSessions(toOrganizationId(activeOrganizationId), "ui");
    },
    queryKey: threadKeys.archivedList(activeOrganizationId),
    refetchInterval: 10_000,
  });
  const threadUiStateQuery = useQuery({
    enabled: activeOrganizationId !== null,
    queryFn: async () => {
      if (activeOrganizationId === null) {
        throw new Error("Organization id is required to list thread UI state.");
      }

      return listSessionThreadUiStates(toOrganizationId(activeOrganizationId));
    },
    queryKey: threadKeys.uiStates(activeOrganizationId),
    refetchInterval: 10_000,
  });
  const agentsById = useMemo(
    () => new Map<string, AgentSummary>((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data],
  );
  const threadUiSnapshot = useMemo(
    () => toThreadUiSnapshot(threadUiStateQuery.data),
    [threadUiStateQuery.data],
  );
  const allThreads = useMemo(() => {
    const sessionList = [
      ...(activeSessionsQuery.data ?? []),
      ...(archivedSessionsQuery.data ?? []),
    ];

    return sessionList
      .map((node) =>
        toThreadListItem({
          actionCapabilities: node.capabilities,
          agentsById,
          session: node.session,
          ui: threadUiSnapshot,
        }),
      )
      .toSorted(compareThreads);
  }, [activeSessionsQuery.data, agentsById, archivedSessionsQuery.data, threadUiSnapshot]);
  const selectedThread = allThreads.find((thread) => thread.id === activeThreadId) ?? null;
  const messagesQuery = useQuery({
    enabled: selectedThread !== null,
    queryFn: async () => {
      if (selectedThread === null) {
        throw new Error("Thread id is required to load messages.");
      }

      return getThreadSessionMessages(toSessionId(selectedThread.id));
    },
    queryKey: threadKeys.detailMessages(activeThreadId),
    refetchInterval:
      selectedThread !== null && isThreadWorking(selectedThread.session) ? 3000 : false,
  });
  const processEventsQuery = useQuery({
    enabled: selectedThread !== null,
    queryFn: async () => {
      if (selectedThread === null) {
        throw new Error("Thread id is required to load process events.");
      }

      return getSessionProcessEvents(toSessionId(selectedThread.id));
    },
    queryKey: threadKeys.processEvents(activeThreadId),
    refetchInterval:
      selectedThread !== null && isThreadWorking(selectedThread.session) ? 3000 : false,
  });
  const retrieveQuery = useQuery({
    enabled: selectedThread !== null,
    queryFn: async () => {
      if (selectedThread === null) {
        throw new Error("Thread id is required to retrieve thread state.");
      }

      return retrieveThreadAgentSession({ sessionId: toSessionId(selectedThread.id) });
    },
    queryKey: threadKeys.retrieve(activeThreadId),
    refetchInterval:
      selectedThread !== null && isThreadWorking(selectedThread.session) ? 5000 : false,
  });
  const filteredThreads = useMemo(
    () => allThreads.filter((thread) => matchesThreadFilter(thread, filter)),
    [allThreads, filter],
  );
  const threadSummary = useMemo(() => summarizeThreads(allThreads), [allThreads]);
  const threadsBySection = useMemo(() => {
    const result: Record<ThreadSection, ThreadListItem[]> = {
      archived: [],
      completed: [],
      pinned: [],
      working: [],
    };

    for (const thread of filteredThreads) {
      result[getThreadSection(thread)].push(thread);
    }

    return result;
  }, [filteredThreads]);
  const loadError =
    activeSessionsQuery.error ??
    archivedSessionsQuery.error ??
    agentsQuery.error ??
    threadUiStateQuery.error;
  const isLoading =
    activeSessionsQuery.isLoading ||
    archivedSessionsQuery.isLoading ||
    agentsQuery.isLoading ||
    threadUiStateQuery.isLoading;

  return {
    agentsQuery,
    allThreads,
    bucketCounts: threadSummary.bucketCounts,
    counts: threadSummary.counts,
    filteredThreads,
    isLoading,
    loadError,
    messagesQuery,
    processEventsQuery,
    retrieveQuery,
    selectedThread,
    threadsBySection,
  };
}
