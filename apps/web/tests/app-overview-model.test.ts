import { describe, expect, test } from "bun:test";

import {
  formatAppCurrency,
  formatAppNumber,
  getAppOverviewQuickstartItems,
  getRecentAppThreads,
  summarizeAppOverview,
} from "../src/routes/app-overview/app-overview-model";
import type { AppOverviewSessionInput } from "../src/routes/app-overview/app-overview-model";

const idleSession: AppOverviewSessionInput = {
  id: "01J00000000000000000000001",
  lastMessageAt: "2026-06-13T12:00:00.000Z",
  lastRun: null,
  status: "IDLE",
  title: "Review imports",
  updatedAt: "2026-06-13T11:59:00.000Z",
};

const workingSession: AppOverviewSessionInput = {
  id: "01J00000000000000000000002",
  lastMessageAt: null,
  lastRun: {
    completedAt: null,
    createdAt: "2026-06-14T09:30:00.000Z",
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    error: null,
    id: "01J00000000000000000000003",
    model: "gpt-5.4",
    provider: "openai",
    startedAt: "2026-06-14T09:30:01.000Z",
    status: "running",
    traceId: null,
    trigger: "manual",
    updatedAt: "2026-06-14T09:31:00.000Z",
  },
  status: "IDLE",
  title: null,
  updatedAt: "2026-06-14T09:30:00.000Z",
};

describe("App overview model", () => {
  test("summarizes App scoped agents, threads, dependencies and cost", () => {
    const metrics = summarizeAppOverview({
      agents: [{ status: "draft" }, { status: "published" }],
      cost: {
        daily: [],
        totals: {
          requestCount: 1200,
          totalCostUsd: 3.25,
        },
      },
      environmentCount: 1,
      mcpServerCount: 2,
      providerCredentialCount: 1,
      sessions: [idleSession, workingSession],
      skillCount: 3,
      spaceCount: 4,
    });

    expect(metrics).toEqual({
      agentCount: 2,
      dependencyCount: 9,
      environmentCount: 1,
      mcpServerCount: 2,
      providerCredentialCount: 1,
      publishedAgentCount: 1,
      requestCount: 1200,
      skillCount: 3,
      spaceCount: 4,
      threadCount: 2,
      totalCostUsd: 3.25,
      workingThreadCount: 1,
    });
  });

  test("orders recent threads by last activity and fills blank titles", () => {
    expect(getRecentAppThreads([idleSession, workingSession], 2)).toEqual([
      {
        id: workingSession.id,
        lastActivityAt: "2026-06-14T09:31:00.000Z",
        status: "working",
        title: "Untitled thread",
      },
      {
        id: idleSession.id,
        lastActivityAt: "2026-06-13T12:00:00.000Z",
        status: "idle",
        title: "Review imports",
      },
    ]);
  });

  test("marks App quickstart from concrete App resources only", () => {
    const items = getAppOverviewQuickstartItems({
      agentCount: 1,
      providerCredentialCount: 0,
      publishedAgentCount: 0,
      threadCount: 1,
    });

    expect(items.map((item) => [item.id, item.complete])).toEqual([
      ["provider-key", false],
      ["agent", true],
      ["thread", true],
      ["publish", false],
    ]);
  });

  test("formats compact App numbers and dollar amounts", () => {
    expect(formatAppCurrency(0.125)).toBe("$0.1250");
    expect(formatAppNumber(1250)).toBe("1.3K");
  });
});
