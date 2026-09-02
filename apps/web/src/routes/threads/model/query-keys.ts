export const threadKeys = {
  archivedList: (projectId: string | null) => ["threads", projectId, "archived"] as const,
  detailMessages: (threadId: string | null) => ["threads", "detail", threadId, "messages"] as const,
  list: (projectId: string | null) => ["threads", projectId, "active"] as const,
  lists: (projectId: string | null) => ["threads", projectId] as const,
  processEvents: (threadId: string | null) => ["threads", "detail", threadId, "process"] as const,
  retrieve: (threadId: string | null) => ["threads", "detail", threadId, "retrieve"] as const,
};
