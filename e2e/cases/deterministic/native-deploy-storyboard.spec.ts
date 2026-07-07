import { expect, test } from "@playwright/test";
import type { Route } from "@playwright/test";

import { formatHarnessError } from "../../lib/env-preflight";
import { fulfillJson, getOperationName, parseGraphQLRequestBody } from "../../lib/graphql-fixture";

/**
 * Deterministic storyboard for the native deploy console at "/". Walks the
 * empty-state install guide → paste a repo URL and deploy → the detection line
 * that names the native run → the per-agent provisioning rows → the green
 * deliverable surface (deployed-agents card + name-addressed Connect surface).
 *
 * The run is a stateful, per-request machine: `DeployApp` starts it and every
 * `AppDeploymentOverview` poll advances one status (queued → success). No
 * timers drive the fixture — the live console polls the overview on its own
 * 2.5s cadence, so the walk is proven by success only appearing after several
 * polls, never by a scripted clock.
 *
 * The "same repo deploys green on a second fresh instance" beat lives in the
 * API portability test (apps/api/tests/native-deployment-portability.test.ts);
 * this spec covers beats 1-2 (empty → deploy) and beat 4 (green surface).
 */

// ULID-shaped ids (parsePlatformId requires Crockford base32, 26 chars).
const organizationId = "01JSBRG000000000000000000A";
const ownerAccountId = "01JSBACCT00000000000000000";
const appId = "01JSBAPP000000000000000000";
const environmentId = "01JSBENV000000000000000000";
const deploymentId = "01JSBDEP000000000000000000";
const runId = "01JSBRN0000000000000000000";

const viewerEmail = "harness-e2e@mosoo.ai";
const ownerName = "E2E Owner";
const now = "2026-07-07T08:00:00.000Z";

const appName = "roadmap-agents";
const appSlug = "roadmap-agents";
const repoOwner = "mosoo-demo";
const repoName = "roadmap-agents";
const repoUrl = `https://github.com/${repoOwner}/${repoName}`;
const plannedUrl = "https://roadmap-agents.apps.mosoo.ai";
const sourceCommitSha = "d34db33fc0ffee00";

// A green multi-agent native run: three agents, all exposed, no web surface —
// so detection derives the "agent api" target and mints a name-addressed
// namespace for every exposed agent.
const nativeAgents = [
  { name: "concierge", source: "primary" },
  { name: "support", source: "named" },
  { name: "triage", source: "named" },
] as const;

const nativeResult = {
  facts: {
    agentCount: nativeAgents.length,
    agents: nativeAgents.map((agent) => ({
      action: "created",
      exposed: true,
      name: agent.name,
      versionNumber: 1,
    })),
    specVersion: "mosoo.spec.v1",
    web: { agent: null, declared: false },
  },
  validate: {
    facts: {
      agentCount: nativeAgents.length,
      agents: nativeAgents.map((agent) => ({
        exposed: true,
        name: agent.name,
        source: agent.source,
      })),
      spec: "mosoo.spec.v1",
      web: { agent: null, declared: false },
    },
    failures: [],
    schemaVersion: 1,
    valid: true,
  },
};

const DEPLOY_STATUSES = [
  "queued",
  "preparing",
  "building",
  "submitting",
  "submitted",
  "activating",
  "success",
] as const;

type DeployStatus = (typeof DEPLOY_STATUSES)[number];

const TERMINAL_INDEX = DEPLOY_STATUSES.length - 1;

function statusAt(index: number): DeployStatus {
  const clamped = Math.max(0, Math.min(index, TERMINAL_INDEX));
  const status = DEPLOY_STATUSES[clamped];

  if (status === undefined) {
    throw new Error("Deploy status index is out of range.");
  }

  return status;
}

interface RunMachine {
  started: boolean;
  /** Index the next `AppDeploymentOverview` poll emits. */
  cursor: number;
  /** Index the last overview poll emitted; the run list mirrors it. */
  emittedIndex: number;
}

function buildRun(status: DeployStatus): Record<string, unknown> {
  return {
    appId,
    createdAt: now,
    deploymentId,
    errorCode: null,
    errorMessage: null,
    id: runId,
    liveUrl: null,
    native: nativeResult,
    plannedUrl,
    sourceBranch: "main",
    sourceCommitSha,
    status,
    targetKind: null,
    updatedAt: now,
  };
}

function buildDeployment(status: DeployStatus): Record<string, unknown> {
  return {
    appId,
    createdAt: now,
    defaultBranch: "main",
    id: deploymentId,
    latestRun: buildRun(status),
    liveUrl: null,
    plannedUrl,
    repoName,
    repoOwner,
    repoUrl,
    updatedAt: now,
  };
}

const app = { id: appId, name: appName, slug: appSlug };

function viewerData(): Record<string, unknown> {
  const organization = {
    avatarUrl: null,
    createdAt: now,
    id: organizationId,
    name: "Harness E2E",
  };

  return {
    viewer: {
      account: {
        email: viewerEmail,
        id: ownerAccountId,
        imageUrl: null,
        name: ownerName,
        systemAgentModel: null,
      },
      activeOrganization: organization,
      auth: {
        currentSecurityLevel: "low",
        methods: ["email_otp"],
      },
      organizations: [organization],
    },
  };
}

function appListData(): Record<string, unknown> {
  return {
    appList: [
      {
        createdAt: now,
        defaultEnvironmentId: environmentId,
        id: appId,
        name: appName,
        ownerAccountId,
        slug: appSlug,
      },
    ],
  };
}

function overviewData(machine: RunMachine): Record<string, unknown> {
  if (!machine.started) {
    return { appOverview: { app, boundAgents: [], deployment: null } };
  }

  const index = Math.min(machine.cursor, TERMINAL_INDEX);
  machine.emittedIndex = index;

  if (machine.cursor < TERMINAL_INDEX) {
    machine.cursor += 1;
  }

  return {
    appOverview: { app, boundAgents: [], deployment: buildDeployment(statusAt(index)) },
  };
}

function runListData(machine: RunMachine): Record<string, unknown> {
  if (!machine.started) {
    return { appDeploymentRunList: [] };
  }

  return { appDeploymentRunList: [buildRun(statusAt(machine.emittedIndex))] };
}

function deployAppData(machine: RunMachine): Record<string, unknown> {
  machine.started = true;
  machine.cursor = 0;
  machine.emittedIndex = 0;

  return { deployApp: buildRun(statusAt(0)) };
}

async function fulfillAuthSessionFixture(route: Route): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({
      session: {
        createdAt: now,
        expiresAt: "2027-07-07T08:00:00.000Z",
        id: "session-e2e-native-deploy",
        ipAddress: null,
        token: "session-token-native-deploy",
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
        name: ownerName,
        updatedAt: now,
      },
    }),
    contentType: "application/json",
    status: 200,
  });
}

function createGraphQLFixture(machine: RunMachine) {
  return async (route: Route): Promise<void> => {
    const body = parseGraphQLRequestBody(route.request().postData());
    const operationName = getOperationName(body);

    switch (operationName) {
      case "Viewer": {
        await fulfillJson(route, viewerData());
        return;
      }
      case "AppList": {
        await fulfillJson(route, appListData());
        return;
      }
      case "AppDeploymentOverview": {
        await fulfillJson(route, overviewData(machine));
        return;
      }
      case "AppDeploymentRunList": {
        await fulfillJson(route, runListData(machine));
        return;
      }
      case "DeployApp": {
        await fulfillJson(route, deployAppData(machine));
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
  };
}

test("Native deploy storyboard walks the install guide to a green multi-agent native surface", async ({
  page,
}) => {
  const machine: RunMachine = { cursor: 0, emittedIndex: 0, started: false };

  await page.route(/\/api\/auth\/get-session(?:\?|$)/u, fulfillAuthSessionFixture);
  await page.route("**/api/graphql", createGraphQLFixture(machine));

  await page.goto("/");

  // Beat 1 — empty state: the install guide and repo-deploy card, no run yet.
  await expect(page.getByRole("heading", { name: /Build agent app with/u })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Deploy from a public GitHub repo" }),
  ).toBeVisible();
  await expect(page.getByTestId("deploy-run-row")).toHaveCount(0);
  await expect(page.getByTestId("deploy-connect-card")).toHaveCount(0);

  // Beat 2 — paste the public repo URL and deploy.
  await page.getByLabel("Public GitHub repo URL").fill(repoUrl);
  await page.getByRole("button", { name: "Deploy" }).click();

  // Beat 3 — the detection line names what the native run resolved to.
  const detection = page.getByTestId("deploy-run-detection");
  await expect(detection).toBeVisible();
  await expect(detection).toContainText("mosoo-native v1 · agent api · 3 agents");

  // Beat 4 — the run details expand into one provisioning row per agent.
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByTestId("deploy-run-details")).toBeVisible();
  const provisionRows = page.getByTestId("deploy-provision-row");
  await expect(provisionRows).toHaveCount(3);
  await expect(provisionRows.first()).toContainText("concierge");
  await expect(provisionRows.first()).toContainText("created");

  // Beat 5 — the per-request machine advances the poll to success. Success only
  // appears after the overview has polled through every in-flight status, so
  // reaching "Live" is itself the proof the stateful walk happened.
  await expect(page.getByTestId("deploy-run-row")).toContainText("Live", { timeout: 40_000 });

  // Beat 6 — the green run's deliverable surface: the deployed-agents roster and
  // the name-addressed Connect surface, addressed by agent name off the slug.
  const agentsCard = page.getByTestId("deploy-agents-card");
  await expect(agentsCard).toBeVisible();
  await expect(agentsCard).toContainText("concierge");
  await expect(agentsCard).toContainText("support");
  await expect(agentsCard).toContainText("triage");

  await expect(page.getByTestId("deploy-connect-card")).toBeVisible();
  const surfaceTable = page.getByTestId("deploy-agent-surface-table");
  await expect(surfaceTable).toBeVisible();
  await expect(surfaceTable).toContainText(
    "POST /api/v1/apps/roadmap-agents/agents/concierge/threads",
  );
  await expect(surfaceTable).toContainText(
    "POST /api/v1/apps/roadmap-agents/agents/triage/threads",
  );
});
