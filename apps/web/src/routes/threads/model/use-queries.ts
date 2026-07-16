import type { AgentSummary } from "@mosoo/contracts/agent";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { fileKeys, listFiles } from "@/domains/file/api/files";
import { getThreadSessionMessages } from "@/domains/session/api/agent-session";
import { retrieveThreadAgentSession } from "@/domains/session/api/agent-session-retrieve";
import { archivedThreadSessions, threadSessions } from "@/domains/session/api/list";
import { getSessionProcessEvents } from "@/domains/session/api/thread-projections";
import { toAppId, toSessionId } from "@/routes/typed-id";

import { threadKeys } from "./query-keys";
import {
  compareThreads,
  getThreadSection,
  isThreadWorking,
  matchesThreadFilter,
  summarizeThreads,
  toThreadListItem,
} from "./thread";
import type { ThreadFilter, ThreadListItem, ThreadSection, ThreadUiSnapshot } from "./thread";

export function useThreadQueries({
  activeAppId,
  activeThreadId,
  filter,
  ui,
}: {
  activeAppId: string | null;
  activeThreadId: string | null;
  filter: ThreadFilter;
  ui: ThreadUiSnapshot;
}) {
  const agentsQuery = useVisibleAgentsQuery(activeAppId);
  const activeSessionsQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list threads.");
      }

      return threadSessions(toAppId(activeAppId), "ui");
    },
    queryKey: threadKeys.list(activeAppId),
    refetchInterval: 10_000,
  });
  const archivedSessionsQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list archived threads.");
      }

      return archivedThreadSessions(toAppId(activeAppId), "ui");
    },
    queryKey: threadKeys.archivedList(activeAppId),
    refetchInterval: 10_000,
  });
  const agentsById = useMemo(
    () => new Map<string, AgentSummary>((agentsQuery.data ?? []).map((agent) => [agent.id, agent])),
    [agentsQuery.data],
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
          ui,
        }),
      )
      .toSorted(compareThreads);
  }, [activeSessionsQuery.data, agentsById, archivedSessionsQuery.data, ui]);
  const selectedThread = allThreads.find((thread) => thread.id === activeThreadId) ?? null;
  const messagesQuery = useQuery({
    enabled: selectedThread !== null,
    queryFn: async () => {
      if (selectedThread === null) {
        throw new Error("Thread id is required to load messages.");
      }

      return getThreadSessionMessages(selectedThread.session.appId, toSessionId(selectedThread.id));
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

      return getSessionProcessEvents(selectedThread.session.appId, toSessionId(selectedThread.id));
    },
    queryKey: threadKeys.processEvents(activeThreadId),
    refetchInterval:
      selectedThread !== null && isThreadWorking(selectedThread.session) ? 3000 : false,
  });
  const artifactsQuery = useQuery({
    enabled: selectedThread !== null,
    queryFn: async () => {
      if (selectedThread === null) {
        throw new Error("Thread id is required to load artifacts.");
      }

      return listFiles({
        appId: selectedThread.session.appId,
        sessionId: toSessionId(selectedThread.id),
        sessionKind: "artifact",
      });
    },
    queryKey:
      selectedThread === null
        ? [...fileKeys.lists(), "thread-artifacts", "missing"]
        : fileKeys.list({
            appId: selectedThread.session.appId,
            sessionId: toSessionId(selectedThread.id),
            sessionKind: "artifact",
          }),
    refetchInterval:
      selectedThread !== null && isThreadWorking(selectedThread.session) ? 3000 : false,
  });
  const retrieveQuery = useQuery({
    enabled: selectedThread !== null,
    queryFn: async () => {
      if (selectedThread === null) {
        throw new Error("Thread id is required to retrieve thread state.");
      }

      return retrieveThreadAgentSession({
        appId: selectedThread.session.appId,
        sessionId: toSessionId(selectedThread.id),
      });
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
  const loadError = activeSessionsQuery.error ?? archivedSessionsQuery.error ?? agentsQuery.error;
  const isLoading =
    activeSessionsQuery.isLoading || archivedSessionsQuery.isLoading || agentsQuery.isLoading;

  return {
    agentsQuery,
    allThreads,
    artifactsQuery,
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
