import type { AgentFileEntry } from "@/domains/agent/api/agent-file-browser-client";

export const DEFAULT_EXPANDED_PATHS = [
  "/",
  "/organization",
  "/organization/sp",
  "/workspace",
  "/workspace/memory",
  "/workspace/se",
];

export const MANUAL_REFRESH_QUERY_OPTIONS = {
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  staleTime: Number.POSITIVE_INFINITY,
} as const;

export const agentFileBrowserKeys = {
  content: (agentId: string, path: string) =>
    ["agent", "file-browser", agentId, "content", path] as const,
  tree: (agentId: string, path: string) =>
    ["agent", "file-browser", agentId, "tree", path] as const,
};

export interface FileTreeQueryState {
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRelativeTime(iso: string): string {
  const elapsedMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsedMs < minute) {
    return "just now";
  }
  if (elapsedMs < hour) {
    return `${Math.floor(elapsedMs / minute)}m ago`;
  }
  if (elapsedMs < day) {
    return `${Math.floor(elapsedMs / hour)}h ago`;
  }
  if (elapsedMs < 7 * day) {
    return `${Math.floor(elapsedMs / day)}d ago`;
  }

  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

export function isExpandable(entry: AgentFileEntry): boolean {
  return entry.kind === "directory";
}

export function isSelectableFile(entry: AgentFileEntry): boolean {
  return entry.kind === "file" || entry.kind === "symlink";
}

export function isCacheEntry(entry: AgentFileEntry): boolean {
  return entry.path === "/workspace/cache" || entry.path.startsWith("/workspace/cache/");
}

export function getVisibleSessionEntries(input: {
  entries: AgentFileEntry[];
  showOlderSessions: boolean;
}): {
  hiddenCount: number;
  visibleEntries: AgentFileEntry[];
} {
  const activeEntries = input.entries.filter((entry) => entry.session?.active === true);
  const idleEntries = input.entries.filter(
    (entry) => entry.session !== null && !entry.session.active,
  );
  const visibleIdleEntries = input.showOlderSessions ? idleEntries : idleEntries.slice(0, 3);

  return {
    hiddenCount: Math.max(0, idleEntries.length - visibleIdleEntries.length),
    visibleEntries: [...activeEntries, ...visibleIdleEntries],
  };
}
