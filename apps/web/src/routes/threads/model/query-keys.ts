export const threadKeys = {
  archivedList: (appId: string | null) => ["threads", appId, "archived"] as const,
  detailMessages: (threadId: string | null) => ["threads", "detail", threadId, "messages"] as const,
  list: (appId: string | null) => ["threads", appId, "active"] as const,
  lists: (appId: string | null) => ["threads", appId] as const,
  processEvents: (threadId: string | null) => ["threads", "detail", threadId, "process"] as const,
  retrieve: (threadId: string | null) => ["threads", "detail", threadId, "retrieve"] as const,
};
