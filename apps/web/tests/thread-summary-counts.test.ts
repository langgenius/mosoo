import { describe, expect, test } from "bun:test";

import type { SessionSummary } from "@mosoo/contracts/session";

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
    organizationId: "org-1",
    provider: "openai",
    runtimeId: "openai-runtime",
    status: "IDLE",
    title: "Thread",
    type: "ui",
    updatedAt: "2026-05-27T00:00:00.000Z",
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
});
