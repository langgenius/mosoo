import type { AgentSummary } from "@mosoo/contracts/agent";
import { getAgentSessionUserLifecycleProjection } from "@mosoo/contracts/session";
import type { AgentSessionActionCapability, SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunStatus } from "@mosoo/contracts/session-run";

export type ThreadBucket = "archived" | "completed" | "working";
export type ThreadSection = "archived" | "completed" | "pinned" | "working";

export const SECTION_ORDER: ThreadSection[] = ["pinned", "working", "completed", "archived"];
export type ThreadFilter = "all" | "failed" | "pinned" | "unread";
export type ThreadStateGlyph = "archived" | "failed" | "success" | "working";

export interface ThreadUiSnapshot {
  pinnedThreadIds: ReadonlySet<string>;
  readAtByThreadId: Readonly<Record<string, string>>;
}

export interface ThreadListItem {
  actionCapabilities: readonly AgentSessionActionCapability[];
  agent: AgentSummary | null;
  agentName: string;
  bucket: ThreadBucket;
  failed: boolean;
  id: string;
  lastActivityAt: string;
  pinned: boolean;
  read: boolean;
  session: SessionSummary;
  statusLine: string;
  title: string;
}

export interface ThreadSummaryCounts {
  bucketCounts: Record<ThreadBucket, number>;
  counts: Record<ThreadFilter, number>;
}

const TITLE_FALLBACK = "Untitled thread";
const TITLE_DISPLAY_LIMIT = 80;

function getThreadDisplayTitle(session: Pick<SessionSummary, "title">): string {
  const trimmed = session.title?.trim() ?? "";

  if (trimmed.length === 0) {
    return TITLE_FALLBACK;
  }

  return trimmed.length > TITLE_DISPLAY_LIMIT
    ? `${trimmed.slice(0, TITLE_DISPLAY_LIMIT - 1)}…`
    : trimmed;
}

const WORKING_RUN_STATUSES = new Set<SessionRunStatus>([
  "booting",
  "queued",
  "running",
  "waiting_input",
]);

const FAILED_RUN_STATUSES = new Set<SessionRunStatus>(["cancelled", "expired", "failed"]);

function getThreadLastActivityAt(session: SessionSummary): string {
  return session.lastMessageAt ?? session.lastRun?.updatedAt ?? session.updatedAt;
}

function isThreadFailed(session: SessionSummary): boolean {
  return session.lastRun !== null && FAILED_RUN_STATUSES.has(session.lastRun.status);
}

export function isThreadWorking(session: SessionSummary): boolean {
  const lifecycle = getAgentSessionUserLifecycleProjection(session);

  if (lifecycle.readOnly) {
    return false;
  }

  if (session.status === "RUNNING" || session.status === "RESCHEDULING") {
    return true;
  }

  return session.lastRun !== null && WORKING_RUN_STATUSES.has(session.lastRun.status);
}

function getThreadBucket(session: SessionSummary): ThreadBucket {
  const lifecycle = getAgentSessionUserLifecycleProjection(session);

  if (lifecycle.state === "asleep") {
    return "archived";
  }

  return isThreadWorking(session) ? "working" : "completed";
}

export function getThreadSection(thread: Pick<ThreadListItem, "bucket" | "pinned">): ThreadSection {
  return thread.pinned ? "pinned" : thread.bucket;
}

export function getThreadStateGlyph(input: {
  bucket: ThreadBucket;
  failed: boolean;
}): ThreadStateGlyph {
  if (input.bucket === "archived") {
    return "archived";
  }

  if (input.bucket === "working") {
    return "working";
  }

  return input.failed ? "failed" : "success";
}

function getThreadStatusLine(session: SessionSummary): string {
  const lifecycle = getAgentSessionUserLifecycleProjection(session);

  if (lifecycle.state === "asleep") {
    return "archived";
  }

  if (session.status === "RESCHEDULING") {
    const previous = getThreadStatusLine({
      ...session,
      archivedAt: null,
      status: "IDLE",
    });
    return `${previous} · reconnecting`;
  }

  if (isThreadWorking(session)) {
    return "working";
  }

  const runStatus = session.lastRun?.status ?? null;

  if (runStatus === "failed") {
    return "failed ✗";
  }

  if (runStatus === "cancelled") {
    return "cancelled ✗";
  }

  if (runStatus === "expired") {
    return "expired ✗";
  }

  if (lifecycle.terminal) {
    return "terminated";
  }

  return "done ✓";
}

export function toThreadListItem(input: {
  agentsById: ReadonlyMap<string, AgentSummary>;
  actionCapabilities: readonly AgentSessionActionCapability[];
  session: SessionSummary;
  ui: ThreadUiSnapshot;
}): ThreadListItem {
  const agent = input.agentsById.get(input.session.agentId) ?? null;
  const lastActivityAt = getThreadLastActivityAt(input.session);
  const readAt = input.ui.readAtByThreadId[input.session.id] ?? null;
  const read = readAt !== null && new Date(readAt).getTime() >= new Date(lastActivityAt).getTime();

  return {
    actionCapabilities: input.actionCapabilities,
    agent,
    agentName: agent?.name ?? "Agent unavailable",
    bucket: getThreadBucket(input.session),
    failed: isThreadFailed(input.session),
    id: input.session.id,
    lastActivityAt,
    pinned: input.ui.pinnedThreadIds.has(input.session.id),
    read,
    session: input.session,
    statusLine: getThreadStatusLine(input.session),
    title: getThreadDisplayTitle(input.session),
  };
}

export function matchesThreadFilter(thread: ThreadListItem, filter: ThreadFilter): boolean {
  switch (filter) {
    case "all": {
      return true;
    }
    case "failed": {
      return thread.failed;
    }
    case "pinned": {
      return thread.pinned;
    }
    case "unread": {
      return !thread.read;
    }
    default: {
      return false;
    }
  }
}

export function summarizeThreads(
  threads: readonly Pick<ThreadListItem, "bucket" | "failed" | "pinned" | "read">[],
): ThreadSummaryCounts {
  const counts: Record<ThreadFilter, number> = {
    all: threads.length,
    failed: 0,
    pinned: 0,
    unread: 0,
  };
  const bucketCounts: Record<ThreadBucket, number> = {
    archived: 0,
    completed: 0,
    working: 0,
  };

  for (const thread of threads) {
    bucketCounts[thread.bucket] += 1;

    if (thread.failed) {
      counts.failed += 1;
    }

    if (thread.pinned) {
      counts.pinned += 1;
    }

    if (!thread.read) {
      counts.unread += 1;
    }
  }

  return { bucketCounts, counts };
}

export function compareThreads(left: ThreadListItem, right: ThreadListItem): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  return new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime();
}
