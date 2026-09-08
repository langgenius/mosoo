import type { Page, Route } from "@playwright/test";

import { formatHarnessError } from "./env-preflight";

// Deterministic console fixtures for the design-contract and typography cases
// (langgenius/mosoo#599, #601, #605). Every Web/API projection the Providers,
// Environments, MCP servers, Runs, and Settings surfaces read is pinned here
// with sanitized demo data, so the browser runs need no provider keys and the
// screenshots they write never contain production content.

export const CONSOLE_FIXTURE_IDS = {
  accountId: "01J00000000000000000000203",
  agentIds: ["01J00000000000000000000301", "01J00000000000000000000302"],
  organizationId: "01J00000000000000000000201",
  projectId: "01J00000000000000000000200",
  secondProjectId: "01J00000000000000000000210",
} as const;

const now = "2026-09-08T08:00:00.000Z";
const earlier = "2026-09-07T16:30:00.000Z";
const lastWeek = "2026-09-01T09:15:00.000Z";

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
        what: "The console fixture received an empty GraphQL request body.",
        why: "Deterministic console cases must pin every API projection they depend on.",
      }),
    );
  }

  const parsed: unknown = JSON.parse(postData);

  if (!isRecord(parsed) || typeof parsed["query"] !== "string") {
    throw new Error(
      formatHarnessError({
        fix: "Send `{ query, variables }` from the Web GraphQL client or add a parser case for the new envelope.",
        what: "The console fixture received a GraphQL request envelope it cannot parse.",
        why: "The fixture is the executable contract for the console surfaces under test.",
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

function getOperationName(body: GraphQLRequestBody): string | null {
  if (body.operationName !== undefined && body.operationName.trim().length > 0) {
    return body.operationName;
  }

  const match = /^\s*(?:query|mutation)\s+([_A-Za-z][_0-9A-Za-z]*)/u.exec(body.query);
  return match?.[1] ?? null;
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
        expiresAt: "2027-09-08T08:00:00.000Z",
        id: "console-fixture-auth-session",
        ipAddress: null,
        token: "console-fixture-auth-token",
        updatedAt: now,
        userAgent: null,
        userId: CONSOLE_FIXTURE_IDS.accountId,
      },
      user: {
        createdAt: now,
        email: "ada@example.com",
        emailVerified: true,
        id: CONSOLE_FIXTURE_IDS.accountId,
        image: null,
        name: "Ada Lovelace",
        updatedAt: now,
      },
    }),
    contentType: "application/json",
    status: 200,
  });
}

function viewer() {
  return {
    viewer: {
      account: {
        email: "ada@example.com",
        id: CONSOLE_FIXTURE_IDS.accountId,
        imageUrl: null,
        name: "Ada Lovelace",
        systemAgentModel: null,
      },
      activeOrganization: {
        avatarUrl: null,
        createdAt: now,
        id: CONSOLE_FIXTURE_IDS.organizationId,
        name: "Analytical Engines",
      },
      auth: {
        currentSecurityLevel: "low",
        methods: ["email_otp"],
      },
      organizations: [
        {
          avatarUrl: null,
          createdAt: now,
          id: CONSOLE_FIXTURE_IDS.organizationId,
          name: "Analytical Engines",
        },
      ],
    },
  };
}

function projectSummary(id: string, name: string) {
  return {
    createdAt: now,
    defaultEnvironmentId: null,
    id,
    name,
    ownerAccountId: CONSOLE_FIXTURE_IDS.accountId,
  };
}

function owner() {
  return { id: CONSOLE_FIXTURE_IDS.accountId, imageUrl: null, name: "Ada Lovelace" };
}

function agents() {
  const [reviewAgentId, releaseAgentId] = CONSOLE_FIXTURE_IDS.agentIds;

  return [
    {
      createdAt: lastWeek,
      description: "Reviews pull requests and leaves inline comments.",
      id: reviewAgentId,
      kind: "cattle",
      name: "Review bot",
      owner: owner(),
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      runtimeId: "claude-code",
      status: "published",
      tools: [],
      updatedAt: earlier,
      viewerRole: "owner",
      visibility: "private",
    },
    {
      createdAt: lastWeek,
      description: "Prepares release notes from merged changes.",
      id: releaseAgentId,
      kind: "pet",
      name: "Release notes",
      owner: owner(),
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      runtimeId: "codex",
      status: "draft",
      tools: [],
      updatedAt: earlier,
      viewerRole: "owner",
      visibility: "private",
    },
  ];
}

function run(
  id: string,
  status: "completed" | "failed" | "running",
  options: { error?: { code: string; message: string } } = {},
) {
  return {
    completedAt: status === "running" ? null : earlier,
    createdAt: earlier,
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    error:
      options.error === undefined
        ? null
        : {
            code: options.error.code,
            details: null,
            message: options.error.message,
            retryable: false,
          },
    id,
    model: "claude-sonnet-5",
    provider: "anthropic",
    startedAt: earlier,
    status,
    traceId: `trace-${id}`,
    trigger: "user_prompt",
    updatedAt: status === "running" ? now : earlier,
  };
}

function session(
  id: string,
  title: string,
  agentId: string,
  options: {
    archived?: boolean;
    lastRun: ReturnType<typeof run> | null;
    status: "IDLE" | "RUNNING" | "TERMINATED";
  },
) {
  return {
    capabilities: [
      { action: "archive_session", reason: null, status: "available" },
      { action: "delete_session", reason: null, status: "available" },
    ],
    session: {
      agentId,
      archivedAt: options.archived === true ? earlier : null,
      createdAt: lastWeek,
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      id,
      kind: "cattle",
      lastMessageAt: options.lastRun?.updatedAt ?? earlier,
      lastRun: options.lastRun,
      model: "claude-sonnet-5",
      provider: "anthropic",
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      runtimeId: "claude-code",
      status: options.status,
      title,
      type: "ui",
      updatedAt: options.lastRun?.updatedAt ?? earlier,
    },
  };
}

function threadSessions(archived: boolean) {
  const [reviewAgentId, releaseAgentId] = CONSOLE_FIXTURE_IDS.agentIds;

  if (archived) {
    return [
      session("01J00000000000000000000404", "Migrate CI to the new runner image", releaseAgentId, {
        archived: true,
        lastRun: run("01J00000000000000000000504", "completed"),
        status: "TERMINATED",
      }),
    ];
  }

  return [
    session(
      "01J00000000000000000000401",
      "Review PR #612: scope API keys to projects",
      reviewAgentId,
      {
        lastRun: run("01J00000000000000000000501", "running"),
        status: "RUNNING",
      },
    ),
    session(
      "01J00000000000000000000402",
      "Draft release notes for 0.9.0 (包含中文变更摘要与英文对照)",
      releaseAgentId,
      {
        lastRun: run("01J00000000000000000000502", "completed"),
        status: "IDLE",
      },
    ),
    session(
      "01J00000000000000000000403",
      "Summarise flaky test failures in apps/api",
      reviewAgentId,
      {
        lastRun: run("01J00000000000000000000503", "failed", {
          error: { code: "sandbox_timeout", message: "Sandbox timed out after 15 minutes." },
        }),
        status: "IDLE",
      },
    ),
  ];
}

function vendorCredentials() {
  return [
    {
      apiBase: null,
      id: "01J00000000000000000000601",
      isDefault: true,
      maskedApiKey: "sk-ant-…4f2c",
      models: null,
      name: "Production",
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      vendorId: "anthropic",
    },
    {
      apiBase: null,
      id: "01J00000000000000000000602",
      isDefault: false,
      maskedApiKey: "sk-ant-…91aa",
      models: null,
      name: "Staging (评测)",
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      vendorId: "anthropic",
    },
    {
      apiBase: "https://api.openai.com/v1",
      id: "01J00000000000000000000603",
      isDefault: true,
      maskedApiKey: "sk-proj-…c0de",
      models: null,
      name: "Production",
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      vendorId: "openai",
    },
  ];
}

function environment(
  id: string,
  name: string,
  options: {
    description: string;
    forkOrigin?: { environmentId: string; name: string; ownerName: string };
    isBuiltIn?: boolean;
    isDefault?: boolean;
    networkPolicy: "full" | "limited";
    usedByAgentCount: number;
  },
) {
  const isBuiltIn = options.isBuiltIn === true;

  return {
    allowMcpServers: true,
    allowPackageManagers: !isBuiltIn,
    allowedHosts:
      options.networkPolicy === "limited" ? ["api.github.com", "registry.npmjs.org"] : [],
    canDelete: !isBuiltIn,
    canEdit: !isBuiltIn,
    createdAt: lastWeek,
    currentRevisionId: `${id.slice(0, 20)}rev001`,
    description: options.description,
    envVars: [{ key: "GITHUB_TOKEN", preview: "ghp_…", status: "configured" }],
    forkOrigin: options.forkOrigin ?? null,
    id,
    isBuiltIn,
    isDefault: options.isDefault === true,
    isEditable: !isBuiltIn,
    name,
    networkPolicy: options.networkPolicy,
    owner: owner(),
    packages: [{ manager: "npm", packages: ["typescript@5.9.2"] }],
    projectId: CONSOLE_FIXTURE_IDS.projectId,
    role: "owner",
    setupScript: "",
    updatedAt: earlier,
    usedByAgentCount: options.usedByAgentCount,
  };
}

function environments() {
  return [
    environment("01J00000000000000000000701", "Default sandbox", {
      description: "Built-in image with Node, Python, and the Mosoo CLI preinstalled.",
      isBuiltIn: true,
      isDefault: true,
      networkPolicy: "full",
      usedByAgentCount: 2,
    }),
    environment("01J00000000000000000000702", "Review runner (restricted egress)", {
      description:
        "Limited network for code review agents. 仅允许访问 GitHub API 与 npm registry，其余出站请求默认拒绝，以便审查结果可复现。",
      forkOrigin: {
        environmentId: "01J00000000000000000000701",
        name: "Default sandbox",
        ownerName: "mosoo",
      },
      networkPolicy: "limited",
      usedByAgentCount: 1,
    }),
    environment("01J00000000000000000000703", "Docs builder", {
      description: "",
      networkPolicy: "full",
      usedByAgentCount: 0,
    }),
  ];
}

function mcpServer(
  id: string,
  name: string,
  options: {
    authType: "bearer" | "oauth";
    description: string | null;
    enabled: boolean;
    state: "active" | "authorization_required" | "disabled";
    subjectLabel?: string;
    url: string;
  },
) {
  const active = options.state === "active";

  return {
    authType: options.authType,
    authorizationState: options.state,
    createdAt: lastWeek,
    credential: active
      ? {
          authType: options.authType,
          createdAt: earlier,
          expiresAt: null,
          id: `${id.slice(0, 20)}cred01`,
          scope: "app",
          scopeValues: [],
          status: "active",
          subjectLabel: options.subjectLabel ?? null,
          updatedAt: earlier,
        }
      : null,
    credentialScope: "app",
    credentialStatus: active ? "active" : "none",
    description: options.description,
    enabled: options.enabled,
    hasCredential: active,
    iconUrl: null,
    id,
    name,
    ownerId: CONSOLE_FIXTURE_IDS.accountId,
    ownerName: "Ada Lovelace",
    projectId: CONSOLE_FIXTURE_IDS.projectId,
    source: "app",
    updatedAt: earlier,
    url: options.url,
  };
}

function mcpRegistry() {
  return {
    mcpRegistry: {
      currentUserEmail: "ada@example.com",
      currentUserId: CONSOLE_FIXTURE_IDS.accountId,
      currentUserName: "Ada Lovelace",
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      servers: [
        mcpServer("01J00000000000000000000801", "GitHub", {
          authType: "oauth",
          description: "Read repositories, issues, and pull requests.",
          enabled: true,
          state: "active",
          subjectLabel: "ada-lovelace",
          url: "https://mcp.example.com/github",
        }),
        mcpServer("01J00000000000000000000802", "Linear", {
          authType: "oauth",
          description: "Create and update issues from agent runs. 支持中文项目名称与标签。",
          enabled: true,
          state: "authorization_required",
          url: "https://mcp.example.com/linear",
        }),
        mcpServer("01J00000000000000000000803", "Internal metrics", {
          authType: "bearer",
          description: null,
          enabled: false,
          state: "disabled",
          url: "https://mcp.example.com/metrics",
        }),
      ],
    },
  };
}

function accessTokens() {
  return {
    tokens: [
      {
        createdAt: lastWeek,
        id: "01J00000000000000000000901",
        label: "CI deploy",
        lastUsedAt: earlier,
        projectId: CONSOLE_FIXTURE_IDS.projectId,
        revokedAt: null,
      },
      {
        createdAt: lastWeek,
        id: "01J00000000000000000000902",
        label: "Local development (本地开发)",
        lastUsedAt: null,
        projectId: CONSOLE_FIXTURE_IDS.projectId,
        revokedAt: null,
      },
    ],
  };
}

export interface ConsoleFixtureOptions {
  /** `html[data-typography]` variant for the typography proof; omitted keeps the shipped roles. */
  typography?: string;
  locale?: string;
}

/**
 * Route every API call the console surfaces under test make to fixture data.
 * Unknown GraphQL operations fail loudly so a new data dependency is pinned on
 * purpose instead of silently rendering an empty or error state.
 */
export async function installConsoleFixtures(
  page: Page,
  options: ConsoleFixtureOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({ locale, projectId, typography }) => {
      localStorage.setItem("mosoo:selected-project", projectId);
      if (locale !== null) {
        localStorage.setItem("mosoo-locale", locale);
      }
      if (typography !== null) {
        document.documentElement.dataset["typography"] = typography;
      }
    },
    {
      locale: options.locale ?? null,
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      typography: options.typography ?? null,
    },
  );

  await page.route(/\/api\/auth\/get-session(?:\?|$)/u, fulfillAuthSessionFixture);
  await page.route(/\/api\/access-tokens(?:\?|$)/u, async (route) => {
    await route.fulfill({
      body: JSON.stringify(accessTokens()),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/graphql", async (route) => {
    const body = parseGraphQLRequestBody(route.request().postData());
    const operationName = getOperationName(body);

    switch (operationName) {
      case "Viewer":
        await fulfillJson(route, viewer());
        return;
      case "ProjectList":
        await fulfillJson(route, {
          projectList: [
            projectSummary(CONSOLE_FIXTURE_IDS.projectId, "Console redesign"),
            projectSummary(CONSOLE_FIXTURE_IDS.secondProjectId, "Billing service"),
          ],
        });
        return;
      case "AccessibleAgents":
        await fulfillJson(route, { accessibleAgentList: agents() });
        return;
      case "ThreadAgentSessionList":
        await fulfillJson(route, {
          threadAgentSessionList: {
            nodes: threadSessions(body.variables?.["archived"] === true),
            pageInfo: { endCursor: null, hasMore: false },
          },
        });
        return;
      case "FileList":
        await fulfillJson(route, { fileList: { files: [] } });
        return;
      case "ProjectSkills":
        await fulfillJson(route, { projectSkillList: [] });
        return;
      case "VendorCredentialList":
        await fulfillJson(route, { vendorCredentialList: vendorCredentials() });
        return;
      case "ProjectEnvironments":
        await fulfillJson(route, { projectEnvironmentList: environments() });
        return;
      case "McpRegistry":
        await fulfillJson(route, mcpRegistry());
        return;
    }

    throw new Error(
      formatHarnessError({
        fix: "Add a fixture for the requested GraphQL root field in e2e/lib/console-fixtures.ts.",
        what: `The console fixture received an unexpected GraphQL request${
          operationName === null ? "" : ` (${operationName})`
        }.`,
        why: "Design-contract cases must make every Web/API projection explicit.",
      }),
    );
  });
}
