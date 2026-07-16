import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { formatHarnessError } from "../../lib/env-preflight";

const appId = "01J00000000000000000000100";
const organizationId = "01J00000000000000000000101";
const sessionId = "01J00000000000000000000102";
const accountId = "01J00000000000000000000103";
const libraryFileId = "01J00000000000000000000104";
const attachmentFileId = "01J00000000000000000000105";
const artifactFileId = "01J00000000000000000000106";
const agentId = "01J00000000000000000000107";
const runId = "01J00000000000000000000108";
const deploymentVersionId = "01J00000000000000000000109";
const now = "2026-06-18T08:00:00.000Z";

interface GraphQLRequestBody {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
}

interface FileListInput {
  sessionId?: string | null;
  sessionKind?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGraphQLRequestBody(postData: string | null): GraphQLRequestBody {
  if (postData === null) {
    throw new Error(
      formatHarnessError({
        fix: "Use requestGraphQL(...) so the fixture can assert the operation and variables.",
        what: "The Files page E2E received an empty GraphQL request body.",
        why: "The deterministic Files page check must pin every API projection it depends on.",
      }),
    );
  }

  const parsed: unknown = JSON.parse(postData);

  if (!isRecord(parsed) || typeof parsed["query"] !== "string") {
    throw new Error(
      formatHarnessError({
        fix: "Send `{ query, variables }` from the Web GraphQL client or add a parser case for the new envelope.",
        what: "The Files page E2E received a GraphQL request envelope it cannot parse.",
        why: "The fixture is the executable contract for the Files page Thread filter.",
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

function readFileListInput(body: GraphQLRequestBody): FileListInput {
  const input = body.variables?.["input"];

  if (!isRecord(input)) {
    return {};
  }

  return {
    ...(typeof input["sessionId"] === "string" || input["sessionId"] === null
      ? { sessionId: input["sessionId"] }
      : {}),
    ...(typeof input["sessionKind"] === "string" || input["sessionKind"] === null
      ? { sessionKind: input["sessionKind"] }
      : {}),
  };
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
        expiresAt: "2027-06-18T08:00:00.000Z",
        id: "files-page-auth-session",
        ipAddress: null,
        token: "files-page-auth-token",
        updatedAt: now,
        userAgent: null,
        userId: accountId,
      },
      user: {
        createdAt: now,
        email: "files-page-e2e@mosoo.ai",
        emailVerified: true,
        id: accountId,
        image: null,
        name: "Files Page E2E",
        updatedAt: now,
      },
    }),
    contentType: "application/json",
    status: 200,
  });
}

function createSessionSummary() {
  return {
    agentId,
    appId,
    archivedAt: null,
    createdAt: now,
    deploymentVersionId,
    deploymentVersionNumber: 1,
    id: sessionId,
    kind: "pet",
    lastMessageAt: now,
    lastRun: {
      completedAt: now,
      createdAt: now,
      deploymentVersionId,
      deploymentVersionNumber: 1,
      error: null,
      id: runId,
      model: "gpt-4.1-mini",
      provider: "openai",
      startedAt: now,
      status: "completed",
      traceId: "trace-files-page-e2e",
      trigger: "user_prompt",
      updatedAt: now,
    },
    model: "gpt-4.1-mini",
    provider: "openai",
    runtimeId: "openai-runtime",
    status: "IDLE",
    title: "Files scope fixture session",
    type: "ui",
    updatedAt: now,
  };
}

function createFileRecord(input: {
  id: string;
  name: string;
  path: string;
  sessionKind: "artifact" | "attachment" | null;
}) {
  return {
    createdAt: now,
    createdBy: accountId,
    etag: null,
    expiresAt: null,
    id: input.id,
    mimeType: "text/plain",
    name: input.name,
    path: input.path,
    sessionKind: input.sessionKind,
    sourcePath: input.sessionKind === "artifact" ? `outputs/${input.name}` : null,
    size: 42,
    scope:
      input.sessionKind === null ? { id: appId, kind: "app" } : { id: sessionId, kind: "session" },
    status: "ready",
    updatedAt: now,
    version: 1,
  };
}

function listFilesForInput(input: FileListInput) {
  const sessionFiles = [
    createFileRecord({
      id: attachmentFileId,
      name: "user-brief.txt",
      path: "attachments/user-brief.txt",
      sessionKind: "attachment",
    }),
    createFileRecord({
      id: artifactFileId,
      name: "runtime-report.md",
      path: "artifacts/runtime-report.md",
      sessionKind: "artifact",
    }),
  ];

  if (input.sessionId !== undefined && input.sessionId !== null) {
    if (input.sessionId !== sessionId) {
      return [];
    }

    return input.sessionKind === undefined || input.sessionKind === null
      ? sessionFiles
      : sessionFiles.filter((file) => file.sessionKind === input.sessionKind);
  }

  if (input.sessionKind !== undefined && input.sessionKind !== null) {
    return sessionFiles.filter((file) => file.sessionKind === input.sessionKind);
  }

  return [
    createFileRecord({
      id: libraryFileId,
      name: "library-seed.csv",
      path: "library-seed.csv",
      sessionKind: null,
    }),
    ...sessionFiles,
  ];
}

async function installFilesPageFixtures(
  page: Page,
  seenFileListInputs: FileListInput[],
): Promise<void> {
  await page.route(/\/api\/auth\/get-session(?:\?|$)/u, fulfillAuthSessionFixture);
  await page.route("**/api/graphql", async (route) => {
    const body = parseGraphQLRequestBody(route.request().postData());
    const operationName = getOperationName(body);

    switch (operationName) {
      case "Viewer": {
        await fulfillJson(route, {
          viewer: {
            account: {
              email: "files-page-e2e@mosoo.ai",
              id: accountId,
              imageUrl: null,
              name: "Files Page E2E",
              systemAgentModel: null,
            },
            activeOrganization: {
              avatarUrl: null,
              createdAt: now,
              id: organizationId,
              name: "Files Page E2E Org",
            },
            auth: {
              currentSecurityLevel: "low",
              methods: ["email_otp"],
            },
            organizations: [
              {
                avatarUrl: null,
                createdAt: now,
                id: organizationId,
                name: "Files Page E2E Org",
              },
            ],
          },
        });
        return;
      }
      case "AppList": {
        await fulfillJson(route, {
          appList: [
            {
              createdAt: now,
              defaultEnvironmentId: null,
              id: appId,
              name: "Files Page E2E App",
              ownerAccountId: accountId,
            },
          ],
        });
        return;
      }
      case "AccessibleAgents": {
        await fulfillJson(route, {
          accessibleAgentList: [],
        });
        return;
      }
      case "ThreadAgentSessionList": {
        const archived = body.variables?.["archived"] === true;

        await fulfillJson(route, {
          threadAgentSessionList: {
            nodes: archived
              ? []
              : [
                  {
                    capabilities: [],
                    session: createSessionSummary(),
                  },
                ],
            pageInfo: {
              endCursor: null,
              hasMore: false,
            },
          },
        });
        return;
      }
      case "FileList": {
        const input = readFileListInput(body);
        seenFileListInputs.push(input);
        await fulfillJson(route, {
          fileList: {
            files: listFilesForInput(input),
          },
        });
        return;
      }
    }

    throw new Error(
      formatHarnessError({
        fix: "Add a fixture for the requested GraphQL root field, or move the assertion to a live smoke if it needs real backend state.",
        what: `The Files page E2E received an unexpected GraphQL request${
          operationName === null ? "" : ` (${operationName})`
        }.`,
        why: "The Files page acceptance test must make every Web/API projection explicit.",
      }),
    );
  });
}

test("Files page lists Thread files and filters by Thread or session kind", async ({ page }) => {
  const seenFileListInputs: FileListInput[] = [];

  await installFilesPageFixtures(page, seenFileListInputs);
  await page.goto("/files");

  await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("row", { name: /library-seed\.csv/u })).toBeVisible();
  await expect(page.getByRole("row", { name: /user-brief\.txt/u })).toBeVisible();
  await expect(page.getByRole("row", { name: /runtime-report\.md/u })).toBeVisible();
  expect(seenFileListInputs).toContainEqual({});

  await page.getByRole("button", { name: "Thread filter" }).click();
  await page.getByRole("menuitem", { name: /Files scope fixture session/u }).click();

  await expect(page.getByRole("row", { name: /library-seed\.csv/u })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /user-brief\.txt/u })).toBeVisible();
  await expect(page.getByRole("row", { name: /runtime-report\.md/u })).toBeVisible();

  await page.getByRole("button", { name: "Artifacts" }).click();

  await expect(page.getByRole("row", { name: /runtime-report\.md/u })).toBeVisible();
  await expect(page.getByRole("row", { name: /user-brief\.txt/u })).toHaveCount(0);

  await page.getByRole("button", { name: "Attachments" }).click();

  await expect(page.getByRole("row", { name: /user-brief\.txt/u })).toBeVisible();
  await expect(page.getByRole("row", { name: /runtime-report\.md/u })).toHaveCount(0);
  expect(seenFileListInputs).toEqual([{}]);
});
