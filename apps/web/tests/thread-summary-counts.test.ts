import { describe, expect, test } from "bun:test";

import type { SessionSummary } from "@mosoo/contracts/session";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";

import { summarizeThreads, toThreadListItem } from "../src/routes/threads/model/thread";
import type {
  ThreadBucket,
  ThreadListItem,
  ThreadUiSnapshot,
} from "../src/routes/threads/model/thread";

type SummaryInput = Pick<ThreadListItem, "bucket" | "failed" | "pinned" | "read">;

function thread(input: {
  bucket?: ThreadBucket;
  failed?: boolean;
  pinned?: boolean;
  read?: boolean;
}): SummaryInput {
  return {
    bucket: input.bucket ?? "completed",
    failed: input.failed ?? false,
    pinned: input.pinned ?? false,
    read: input.read ?? true,
  };
}

function session(id: string): SessionSummary {
  return {
    agentId: "agent-1",
    archivedAt: null,
    createdAt: "2026-05-27T00:00:00.000Z",
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    id,
    kind: "cattle",
    lastMessageAt: null,
    lastRun: null,
    model: "gpt-5.4",
    provider: "openai",
    appId: "app-1",
    runtimeId: "openai-runtime",
    status: "IDLE",
    title: "Thread",
    type: "ui",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

function run(input: Pick<SessionRunSummary, "status">): SessionRunSummary {
  return {
    completedAt: input.status === "completed" ? "2026-05-27T00:01:00.000Z" : null,
    createdAt: "2026-05-27T00:00:00.000Z",
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    error: null,
    id: "run-1",
    model: "gpt-5.4",
    provider: "openai",
    startedAt: "2026-05-27T00:00:01.000Z",
    status: input.status,
    traceId: "trace-1",
    trigger: "user_prompt",
    updatedAt: "2026-05-27T00:01:00.000Z",
  };
}

describe("thread summary counts", () => {
  test("counts filters and buckets in one summary pass", () => {
    const summary = summarizeThreads([
      thread({ bucket: "working", pinned: true, read: false }),
      thread({ bucket: "completed", failed: true }),
      thread({ bucket: "archived", read: false }),
    ]);

    expect(summary.counts).toEqual({
      all: 3,
      failed: 1,
      pinned: 1,
      unread: 2,
    });
    expect(summary.bucketCounts).toEqual({
      archived: 1,
      completed: 1,
      working: 1,
    });
  });

  test("resolves pinned state through a set-backed UI snapshot", () => {
    const ui = {
      pinnedThreadIds: new Set(["thread-1"]),
      readAtByThreadId: {},
    } satisfies ThreadUiSnapshot;

    expect(
      toThreadListItem({
        actionCapabilities: [],
        agentsById: new Map(),
        session: session("thread-1"),
        ui,
      }).pinned,
    ).toBe(true);
  });

  test("uses session lifecycle projection for archive and terminal buckets", () => {
    const ui = {
      pinnedThreadIds: new Set<string>(),
      readAtByThreadId: {},
    } satisfies ThreadUiSnapshot;
    const archived = toThreadListItem({
      actionCapabilities: [],
      agentsById: new Map(),
      session: {
        ...session("thread-archived"),
        archivedAt: "2026-06-01T00:00:00.000Z",
        status: "RUNNING",
      },
      ui,
    });
    const terminal = toThreadListItem({
      actionCapabilities: [],
      agentsById: new Map(),
      session: {
        ...session("thread-terminal"),
        archivedAt: "2026-06-01T00:00:00.000Z",
        status: "TERMINATED",
        title: "Archived copy",
      },
      ui,
    });

    expect(archived.bucket).toBe("archived");
    expect(terminal.bucket).toBe("completed");
  });

  test("does not treat stale rescheduling sessions with terminal runs as working", () => {
    const ui = {
      pinnedThreadIds: new Set<string>(),
      readAtByThreadId: {},
    } satisfies ThreadUiSnapshot;
    const threadItem = toThreadListItem({
      actionCapabilities: [],
      agentsById: new Map(),
      session: {
        ...session("thread-stale-rescheduling"),
        lastRun: run({ status: "completed" }),
        status: "RESCHEDULING",
      },
      ui,
    });

    expect(threadItem.bucket).toBe("completed");
    expect(threadItem.statusLine).not.toContain("reconnecting");
  });
});
