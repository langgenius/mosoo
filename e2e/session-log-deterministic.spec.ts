import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { formatHarnessError } from "./harness-error";
import { createRuntimeSignalCollector } from "./runtime-signal-collector";

const agentId = "agent-e2e-harness-contract";
const organizationId = "org-e2e-harness";
const sessionId = "session-e2e-harness-replay";
const now = "2026-05-18T08:00:00.000Z";
const liveVersion = {
  agentId,
  createdAt: now,
  createdByAccountId: "acct-e2e-owner",
  environmentId: "env-e2e",
  id: "agent-version-e2e-3",
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
  id: "run-e2e-harness-1",
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
  runtimeId: liveVersion.runtimeId,
  status: "IDLE",
  title: "Harness contract acceptance replay",
  updatedAt: "2026-05-18T08:00:19.000Z",
};
const owner = {
  id: "acct-e2e-owner",
  imageUrl: null,
  name: "E2E Owner",
};
const organization = {
  createdAt: now,
  id: organizationId,
  joinPolicy: "domain_request",
  kind: "personal",
  name: "Harness E2E",
  primaryDomain: null,
  slug: "harness-e2e",
  viewerRole: "owner",
};
const agentDetail = {
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
      serverId: "shell",
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
    agentsFileId: null,
    boundSpaceIds: ["space-e2e-docs"],
    environmentId: "env-e2e",
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

async function fulfillGraphQLFixture(route: Route): Promise<void> {
  const body = parseGraphQLRequestBody(route.request().postData());
  const operationName = getOperationName(body);

  switch (operationName) {
    case "Viewer": {
      await fulfillJson(route, {
        viewer: {
          account: {
            email: "harness-e2e@mosoo.ai",
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
          memberships: [
            {
              joinedAt: now,
              organization,
              role: "owner",
            },
          ],
          organizationCreationSlot: {
            occupied: true,
            organizationId,
          },
        },
      });
      return;
    }
    case "PendingOrganizationInvitations": {
      await fulfillJson(route, {
        pendingOrganizationInvitationList: [],
      });
      return;
    }
    case "OrganizationMembers": {
      await fulfillJson(route, {
        organizationMemberList: [
          {
            accountId: owner.id,
            disabledAt: null,
            disabledByAccountId: null,
            email: "harness-e2e@mosoo.ai",
            imageUrl: null,
            joinedAt: now,
            name: owner.name,
            role: "owner",
            status: "active",
          },
        ],
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
        agentSessionList: [sessionSummary],
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
            spaces: [{ spaceId: "space-e2e-docs" }],
            tools: [{ credentialMode: "runtime_resolved", serverId: "shell" }],
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
  await expect(logs).toContainText("Session snapshot");
  await runtimeSignals.sampleResources(page, "after-session-log-assertions");
  runtimeSignals.checkpoint("session-log.exit", {
    renderedEvents: processEvents.length,
    sessionId,
  });
  runtimeSignals.assertCoverage();
  await runtimeSignals.attachArtifact(testInfo);
});
