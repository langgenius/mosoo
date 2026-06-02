export const threadKeys = {
  archivedList: (organizationId: string | null) => ["threads", organizationId, "archived"] as const,
  detailMessages: (threadId: string | null) => ["threads", "detail", threadId, "messages"] as const,
  list: (organizationId: string | null) => ["threads", organizationId, "active"] as const,
  lists: (organizationId: string | null) => ["threads", organizationId] as const,
  processEvents: (threadId: string | null) => ["threads", "detail", threadId, "process"] as const,
  retrieve: (threadId: string | null) => ["threads", "detail", threadId, "retrieve"] as const,
  uiStates: (organizationId: string | null) => ["threads", organizationId, "ui-state"] as const,
};
