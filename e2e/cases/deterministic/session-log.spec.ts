import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { formatHarnessError } from "../../lib/env-preflight";
import { createRuntimeSignalCollector } from "../../lib/runtime-progress";

const agentId = "01J00000000000000000000001";
const organizationId = "01J00000000000000000000002";
const sessionId = "01J00000000000000000000003";
const ownerAccountId = "01J00000000000000000000004";
const environmentId = "01J00000000000000000000005";
const deploymentVersionId = "01J00000000000000000000006";
const sessionRunId = "01J00000000000000000000007";
const shellServerId = "01J00000000000000000000008";
const projectId = "01J00000000000000000000009";
const viewerEmail = "harness-e2e@mosoo.ai";
const now = "2026-05-18T08:00:00.000Z";
const liveVersion = {
  agentId,
  createdAt: now,
  createdByAccountId: ownerAccountId,
  environmentId,
  id: deploymentVersionId,
  isLive: true,
  kind: "pet",
  model: "gpt-4.1-mini",
  provider: "openai",
  runtimeId: "openai-runtime",
  summary: "Deterministic E2E fixture",
  versionNumber: 3,
};
const sessionLastRun = {
  completedAt: "2026-05-18T08:00:19.000Z",
  createdAt: "2026-05-18T08:00:01.000Z",
  deploymentVersionId: liveVersion.id,
  deploymentVersionNumber: liveVersion.versionNumber,
  error: null,
  id: sessionRunId,
  model: liveVersion.model,
  provider: liveVersion.provider,
  startedAt: "2026-05-18T08:00:02.000Z",
  status: "completed",
  traceId: "trace-e2e-harness-1",
  trigger: "user_prompt",
  updatedAt: "2026-05-18T08:00:19.000Z",
};
const sessionSummary = {
  agentId,
  archivedAt: null,
  createdAt: "2026-05-18T08:00:00.000Z",
  deploymentVersionId: liveVersion.id,
  deploymentVersionNumber: liveVersion.versionNumber,
  id: sessionId,
  kind: "pet",
  lastMessageAt: "2026-05-18T08:00:19.000Z",
  lastRun: sessionLastRun,
  model: liveVersion.model,
  organizationId,
  provider: liveVersion.provider,
  projectId,
  runtimeId: liveVersion.runtimeId,
  status: "IDLE",
  title: "Harness contract acceptance replay",
  type: "preview",
  updatedAt: "2026-05-18T08:00:19.000Z",
};
const owner = {
  id: ownerAccountId,
  imageUrl: null,
  name: "E2E Owner",
};
const organization = {
  avatarUrl: null,
  createdAt: now,
  id: organizationId,
  joinPolicy: "domain_request",
  kind: "personal",
  name: "Harness E2E",
  primaryDomain: null,
  viewerRole: "owner",
};
const agentDetail = {
  projectId,
  createdAt: now,
  description: "Fixture-backed agent for deterministic session log coverage.",
  id: agentId,
  kind: "pet",
  liveVersion,
  model: liveVersion.model,
  name: "Harness Contract Agent",
  organizationId,
  owner,
  packageSharingEnabled: false,
  prompt: "Replay harness contract posture.",
  provider: liveVersion.provider,
  runtimeId: liveVersion.runtimeId,
  skills: [],
  status: "published",
  tools: [
    {
      enabled: true,
      iconUrl: null,
      name: "Shell",
      serverId: shellServerId,
    },
  ],
  updatedAt: now,
  versions: [liveVersion],
  viewerRole: "owner",
  visibility: "private",
};
const editorState = {
  collaborators: [],
  environment: {
    environmentId,
  },
  id: agentId,
  mcpBindings: [],
  packageResolution: null,
  readiness: {
    checkedAt: now,
    issues: [],
    ready: true,
  },
};
const processEvents = [
  {
    content: "Check whether the session log PRD has deterministic E2E coverage.",
    durationMs: 30,
    id: "event-e2e-user",
    occurredAt: "2026-05-18T08:00:01.000Z",
    status: "available",
    tokens: 16,
    type: "user_message",
  },
  {
    content: "run.started",
    durationMs: 12,
    id: "event-e2e-run-started",
    occurredAt: "2026-05-18T08:00:02.000Z",
    status: "available",
    tokens: null,
    type: "run_started",
  },
  {
    content: "Reading the session log acceptance checklist.",
    durationMs: 1200,
    id: "event-e2e-tool-started",
    occurredAt: "2026-05-18T08:00:04.000Z",
    status: "available",
    tokens: 22,
    type: "tool_use_started",
  },
  {
    content: "L1 deterministic E2E required for durable transcript projection.",
    durationMs: 1800,
    id: "event-e2e-tool-completed",
    occurredAt: "2026-05-18T08:00:07.000Z",
    status: "available",
    tokens: 31,
    type: "tool_use_completed",
  },
  {
    content: "Session log has durable transcript projection coverage without external credentials.",
    durationMs: 2600,
    id: "event-e2e-agent-message",
    occurredAt: "2026-05-18T08:00:11.000Z",
    status: "available",
    tokens: 34,
    type: "agent_message_delta",
  },
  {
    content: "input=62 output=41",
    durationMs: 10,
    id: "event-e2e-usage",
    occurredAt: "2026-05-18T08:00:17.000Z",
    status: "available",
    tokens: 103,
    type: "usage_updated",
  },
  {
    content: "run.completed",
    durationMs: 20,
    id: "event-e2e-run-completed",
    occurredAt: "2026-05-18T08:00:19.000Z",
    status: "available",
    tokens: null,
    type: "run_completed",
  },
];

interface GraphQLRequestBody {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGraphQLRequestBody(postData: string | null): GraphQLRequestBody {
  if (postData === null) {
    throw new Error(
      formatHarnessError({
        fix: "Use requestGraphQL(...) so the fixture can assert the operation and variables.",
        what: "The deterministic E2E received an empty GraphQL request body.",
        why: "L1 deterministic E2E must pin every API projection it depends on.",
      }),
    );
  }

  const parsed: unknown = JSON.parse(postData);

  if (!isRecord(parsed) || typeof parsed["query"] !== "string") {
    throw new Error(
      formatHarnessError({
        fix: "Send `{ query, variables }` from the Web GraphQL client or add a parser case for the new envelope.",
        what: "The deterministic E2E received a GraphQL request envelope it cannot parse.",
        why: "The fixture is the executable contract for the Web/API projection in this no-credential harness.",
      }),
    );
  }

  return {
    ...(typeof parsed["operationName"] === "string"
      ? { operationName: parsed["operationName"] }
      : {}),
    query: parsed["query"],
    ...(isRecord(parsed["variables"]) ? { variables: parsed["variables"] } : {}),
  };
}

function isGraphQLNameStart(value: string): boolean {
  const code = value.charCodeAt(0);

  return value === "_" || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isGraphQLNameContinue(value: string): boolean {
  const code = value.charCodeAt(0);

  return isGraphQLNameStart(value) || (code >= 48 && code <= 57);
}

function skipGraphQLIgnored(query: string, start: number): number {
  let index = start;

  while (index < query.length) {
    const value = query[index];

    if (value === " " || value === "\n" || value === "\r" || value === "\t" || value === ",") {
      index += 1;
      continue;
    }

    return index;
  }

  return index;
}

function readGraphQLName(query: string, start: number): { end: number; name: string } | null {
  const first = query[start];

  if (first === undefined || !isGraphQLNameStart(first)) {
    return null;
  }

  let end = start + 1;

  while (end < query.length) {
    const value = query[end];

    if (value === undefined || !isGraphQLNameContinue(value)) {
      break;
    }

    end += 1;
  }

  return {
    end,
    name: query.slice(start, end),
  };
}

function getOperationName(body: GraphQLRequestBody): string | null {
  if (body.operationName !== undefined && body.operationName.trim().length > 0) {
    return body.operationName;
  }

  const operation = readGraphQLName(body.query, skipGraphQLIgnored(body.query, 0));

  if (operation === null || (operation.name !== "query" && operation.name !== "mutation")) {
    return null;
  }

  const nameStart = skipGraphQLIgnored(body.query, operation.end);

  if (body.query[nameStart] === "{" || body.query[nameStart] === "(") {
    return null;
  }

  return readGraphQLName(body.query, nameStart)?.name ?? null;
}

async function fulfillJson(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({ data }),
    contentType: "application/json",
    status: 200,
  });
}

async function fulfillAuthSessionFixture(route: Route): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({
      session: {
        createdAt: now,
        expiresAt: "2027-05-18T08:00:00.000Z",
        id: "session-e2e-auth",
        ipAddress: null,
        token: "session-token-e2e",
        updatedAt: now,
        userAgent: null,
        userId: ownerAccountId,
      },
      user: {
        createdAt: now,
        email: viewerEmail,
        emailVerified: true,
        id: ownerAccountId,
        image: null,
        name: owner.name,
        updatedAt: now,
      },
    }),
    contentType: "application/json",
    status: 200,
  });
}

async function fulfillGraphQLFixture(route: Route): Promise<void> {
  const body = parseGraphQLRequestBody(route.request().postData());
  const operationName = getOperationName(body);

  switch (operationName) {
    case "Viewer": {
      await fulfillJson(route, {
        viewer: {
          account: {
            email: viewerEmail,
            id: owner.id,
            imageUrl: null,
            name: owner.name,
            systemAgentModel: null,
          },
          activeOrganization: organization,
          auth: {
            currentSecurityLevel: "low",
            methods: ["email_otp"],
          },
          organizations: [organization],
        },
      });
      return;
    }
    case "ProjectList": {
      await fulfillJson(route, {
        projectList: [
          {
            createdAt: now,
            defaultEnvironmentId: environmentId,
            id: projectId,
            name: "Harness E2E Project",
            ownerAccountId,
          },
        ],
      });
      return;
    }
    case "McpRegistry": {
      await fulfillJson(route, {
        mcpRegistry: {
          projectId,
          currentUserEmail: viewerEmail,
          currentUserId: ownerAccountId,
          currentUserName: owner.name,
          servers: [],
        },
      });
      return;
    }
    case "AgentEditorState": {
      await fulfillJson(route, {
        agentEditorState: editorState,
      });
      return;
    }
    case "AgentSessionList": {
      await fulfillJson(route, {
        agentSessionList: {
          nodes: [sessionSummary],
        },
      });
      return;
    }
    case "AgentSessionProcessEvents": {
      await fulfillJson(route, {
        sessionProcessEvents: processEvents,
      });
      return;
    }
    case "AgentSessionDiagnostics": {
      await fulfillJson(route, {
        agentSessionDiagnostics: {
          execution: {
            binding: {
              deploymentVersionId: liveVersion.id,
              deploymentVersionNumber: liveVersion.versionNumber,
              kind: liveVersion.kind,
              model: liveVersion.model,
              provider: liveVersion.provider,
              runtimeId: liveVersion.runtimeId,
              sessionId,
            },
            skills: [],
            tools: [{ credentialMode: "runtime_resolved", serverId: shellServerId }],
          },
          generatedAt: now,
          nativeRuntimeRef: {
            kind: null,
            runtimeId: liveVersion.runtimeId,
            status: "absent",
            valuePreview: null,
          },
          pendingPermissionCount: 0,
          session: {
            deploymentVersionId: liveVersion.id,
            deploymentVersionNumber: liveVersion.versionNumber,
            id: sessionId,
            kind: liveVersion.kind,
            lastRun: {
              deploymentVersionId: liveVersion.id,
              deploymentVersionNumber: liveVersion.versionNumber,
              id: sessionLastRun.id,
              model: sessionLastRun.model,
              provider: sessionLastRun.provider,
              status: sessionLastRun.status,
              traceId: sessionLastRun.traceId,
            },
            model: liveVersion.model,
            provider: liveVersion.provider,
            runtimeId: liveVersion.runtimeId,
            status: sessionSummary.status,
            title: sessionSummary.title,
          },
        },
      });
      return;
    }
    case "Agent": {
      await fulfillJson(route, {
        agent: agentDetail,
      });
      return;
    }
  }

  throw new Error(
    formatHarnessError({
      fix: "Add a fixture for the requested GraphQL root field, or move the assertion to a live smoke if it needs real backend state.",
      what: `The deterministic E2E received an unexpected GraphQL request${
        operationName === null ? "" : ` (${operationName})`
      }.`,
      why: "L1 deterministic E2E must make every Web/API projection explicit so PRD acceptance does not silently depend on live services.",
    }),
  );
}

async function installDeterministicFixtures(page: Page): Promise<void> {
  await page.route(/\/api\/auth\/get-session(?:\?|$)/u, fulfillAuthSessionFixture);
  await page.route("**/api/graphql", fulfillGraphQLFixture);
}

test("Session log acceptance replay renders durable transcript and diagnostics without external credentials", async ({
  page,
}, testInfo) => {
  const runtimeSignals = createRuntimeSignalCollector({
    source: "session-log-deterministic",
  });

  runtimeSignals.attachToPage(page);
  await installDeterministicFixtures(page);
  await runtimeSignals.sampleResources(page, "before-session-log-navigation");
  runtimeSignals.checkpoint("session-log.entry", {
    route: `/agent/${agentId}?tab=logs`,
    sessionId,
  });

  await page.goto(`/agent/${agentId}?tab=logs`);

  const logs = page.getByTestId("agent-diagnostics-logs");

  await expect(logs).toBeVisible();
  await expect(logs).toContainText("Harness contract acceptance replay");
  await expect(logs).toContainText("Sessions");
  await expect(logs).not.toContainText("sessionEvents.event");
  runtimeSignals.checkpoint("session-log.list.visible", {
    sessionId,
  });
  await logs.getByRole("button", { name: /Harness contract acceptance replay/u }).click();
  await expect(page).toHaveURL(new RegExp(`session=${sessionId}`, "u"));
  runtimeSignals.checkpoint("session-log.diagnostics.visible", {
    sessionId,
  });
  await expect(logs).toContainText("Harness contract acceptance replay");
  await expect(logs).toContainText(
    "Check whether the session log PRD has deterministic E2E coverage.",
  );
  await expect(logs).toContainText("Reading the session log acceptance checklist.");
  await expect(logs).toContainText("durable transcript projection");
  await expect(logs).toContainText("Diagnostics");
  await logs.getByRole("button", { name: "Expand diagnostics" }).click();
  await expect(logs).toContainText("Session snapshot");
  await runtimeSignals.sampleResources(page, "after-session-log-assertions");
  runtimeSignals.checkpoint("session-log.exit", {
    renderedEvents: processEvents.length,
    sessionId,
  });
  runtimeSignals.assertCoverage();
  await runtimeSignals.attachArtifact(testInfo);
});

test("reported Chinese help copy and MCP dialog scrolling render in a real browser", async ({
  page,
}) => {
  await installDeterministicFixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem("mosoo-locale", "zh-CN");
  });

  await page.goto(`/agent/${agentId}?tab=logs`);
  await page.getByRole("button", { name: "帮助与文档" }).click();

  const helpDialog = page.getByRole("dialog");
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog).toContainText("入门指南");
  await expect(helpDialog).toContainText("快速开始");
  await expect(helpDialog).toContainText("身份验证与访问");
  await expect(helpDialog).toContainText("Thread 与运行");
  await expect(helpDialog).not.toContainText("Getting started");
  await expect(helpDialog).not.toContainText("Authentication and access");
  await helpDialog.getByRole("textbox", { name: "搜索帮助和文档" }).fill("归档");
  await expect(helpDialog).toContainText("归档 Thread");
  await expect(helpDialog).toContainText("取消归档 Thread");
  await expect(helpDialog).not.toContainText("Archive a Thread");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ height: 500, width: 900 });
  await page.goto("/integrations/mcp");
  await page.getByRole("button", { name: "添加 MCP" }).first().click();
  const mcpDialog = page.getByRole("dialog");
  await expect(mcpDialog).toContainText("添加 MCP 连接");
  await mcpDialog.getByRole("button", { name: "高级设置" }).click();

  const scrollBody = mcpDialog.locator(".overflow-y-auto");
  const before = await scrollBody.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  await scrollBody.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const after = await scrollBody.evaluate((element) => element.scrollTop);
  expect(after).toBeGreaterThan(0);

  const cancelBox = await mcpDialog.getByRole("button", { name: "取消" }).boundingBox();
  expect(cancelBox).not.toBeNull();
  expect((cancelBox?.y ?? 501) + (cancelBox?.height ?? 0)).toBeLessThanOrEqual(500);
});
