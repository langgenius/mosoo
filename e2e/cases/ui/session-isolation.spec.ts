import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { CONSOLE_FIXTURE_IDS, installConsoleFixtures } from "../../lib/console-fixtures";

const output = fileURLToPath(new URL("../../../.tmp/e2e/session-isolation/", import.meta.url));
test.setTimeout(30_000);

const agentId = CONSOLE_FIXTURE_IDS.agentIds[0];
const now = "2026-09-22T00:00:00Z";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// UI wiring only. D1 creation/import/fork and existing Session ownership are
// verified by API tests; this fixture never invokes a model or a real API.
for (const kind of ["cattle", "pet"] as const) {
  test(`Session isolation: ${kind} configuration has no type selection`, async ({ page }) => {
    await installConsoleFixtures(page, { locale: "en" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const writes: Record<string, unknown>[] = [];
    const operations: string[] = [];
    let failedSave = false;
    let agent = {
      createdAt: now,
      description: "UI acceptance fixture",
      id: agentId,
      kind,
      liveVersion: null,
      model: "gpt-5.4",
      name: "Session configuration",
      owner: { id: CONSOLE_FIXTURE_IDS.accountId, imageUrl: null, name: "Fixture owner" },
      projectId: CONSOLE_FIXTURE_IDS.projectId,
      prompt: "Retain these instructions.",
      provider: "openai",
      runtimeId: "openai-runtime",
      skills: [],
      status: kind === "pet" ? "published" : "draft",
      tools: [],
      updatedAt: now,
      versions: [],
      viewerRole: "owner",
      visibility: "private",
    };
    await page.route("**/api/graphql", async (route) => {
      const body: unknown = route.request().postDataJSON();
      if (!isRecord(body) || typeof body["query"] !== "string") {
        throw new Error("Expected a GraphQL request.");
      }
      const operation = /(?:query|mutation)\s+(\w+)/u.exec(body["query"])?.[1];
      if (operation) operations.push(operation);
      if (operation === "UpdateAgentConfig" && kind === "pet" && !failedSave) {
        failedSave = true;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ errors: [{ message: "Temporary preset save failure" }] }),
        });
        return;
      }
      let data: unknown;
      if (operation === "CreateAgent" || operation === "UpdateAgentConfig") {
        const variables = body["variables"];
        const input = isRecord(variables) ? variables["input"] : null;
        if (!isRecord(input)) throw new Error("Expected a configuration input.");
        expect(input).not.toHaveProperty("kind");
        writes.push(input);
        agent = {
          ...agent,
          name: typeof input["name"] === "string" ? input["name"] : agent.name,
          prompt: typeof input["prompt"] === "string" ? input["prompt"] : agent.prompt,
          model: typeof input["model"] === "string" ? input["model"] : agent.model,
          provider: typeof input["provider"] === "string" ? input["provider"] : agent.provider,
          runtimeId: typeof input["runtimeId"] === "string" ? input["runtimeId"] : agent.runtimeId,
        };
        data = operation === "CreateAgent" ? { createAgent: agent } : { updateAgentConfig: agent };
      } else if (operation === "Agent") {
        data = { agent };
      } else if (operation === "AgentEditorState") {
        data = {
          agentEditorState: {
            id: agentId,
            builtInTools: [],
            environment: { environmentId: null },
            mcpBindings: [],
            packageResolution: null,
            providerOptions: {},
            readiness: { checkedAt: now, issues: [], ready: true },
          },
        };
      } else if (operation === "AgentSessionList") {
        data = { agentSessionList: { nodes: [] } };
      } else if (operation === "AvailableAgentModels") {
        data = {
          availableAgentModels: [
            {
              available: true,
              displayName: agent.model,
              modelId: agent.model,
              vendorId: agent.provider,
              vendorLabel: "OpenAI",
              source: "preset",
              reason: null,
              statusDetail: null,
              statusLabel: "Available",
            },
          ],
        };
      } else {
        await route.fallback();
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
    });

    if (kind === "cattle") {
      await page.goto("/agent?create=1");
      const dialog = page.getByRole("dialog", { name: "New Agent" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Name").fill("Session configuration");
      await dialog.getByRole("button", { name: /OpenAI/u }).click();
      await dialog.getByRole("button", { name: "Create", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/agent/${agentId}`, "u"));
    } else {
      await page.goto(`/agent/${agentId}?tab=preview`);
    }

    await expect(page.getByRole("textbox", { name: "System prompt", exact: true })).toBeVisible();
    await expect(page.getByTestId("agent-preview-panel")).toBeVisible();
    await expect(page.getByText(agent.model, { exact: true })).toBeVisible();
    await expect(
      page.getByText(/^(Assistant Agent|Task Agent|Agent type|Switch type)$/u),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "System prompt", exact: true })
      .fill("Edited durable instructions.");
    if (kind === "pet") {
      await expect(page.getByRole("alert")).toContainText("Temporary preset save failure");
      await page.getByRole("button", { name: "Retry", exact: true }).click();
    }
    await expect
      .poll(() => writes.some((write) => write["prompt"] === "Edited durable instructions."))
      .toBe(true);
    if (kind === "pet") {
      const claude = page.getByRole("button", { name: /Claude Agent SDK|Claude Code/u });
      await expect(claude).toBeEnabled();
      await claude.click();
      await expect
        .poll(() => writes.some((write) => write["runtimeId"] === "claude-agent-sdk"))
        .toBe(true);
    }
    expect(agent.kind).toBe(kind);
    expect(
      operations.filter((name) =>
        ["RestartDriver", "RecreateSandbox", "ResetAgentState", "CreateAgentFork"].includes(name),
      ),
    ).toEqual([]);
    await expect(page.getByTestId("preset-session-scope")).toContainText(
      "Existing sessions keep their original configuration",
    );
    await expect(page.getByRole("button", { name: "Open terminal", exact: true })).toHaveCount(0);
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: `${output}${kind}-editor.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("direct Session maintenance targets only the selected Session and exposes a retryable failure", async ({
  page,
}) => {
  await installConsoleFixtures(page, { locale: "en" });
  const selected = "01J00000000000000000000410";
  const sibling = "01J00000000000000000000411";
  const calls: { operation: string; variables: Record<string, unknown> }[] = [];
  const sessions = [selected, sibling].map((id) => ({
    agentId: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    id,
    kind: "cattle",
    lastMessageAt: now,
    lastRun: null,
    model: "gpt-5.4",
    provider: "openai",
    projectId: CONSOLE_FIXTURE_IDS.projectId,
    runtimeId: "openai-runtime",
    status: "IDLE",
    title: id === selected ? "Direct Session" : "Sibling Session",
    type: "ui",
  }));
  const capabilities = [
    { action: "archive_session", reason: null, status: "available" },
    { action: "delete_session", reason: null, status: "available" },
  ];
  let failedRecreate = false;
  await page.route("**/api/graphql", async (route) => {
    const body: unknown = route.request().postDataJSON();
    if (!isRecord(body) || typeof body["query"] !== "string")
      throw new Error("Expected GraphQL request");
    const operation = /(?:query|mutation)\s+(\w+)/u.exec(body["query"])?.[1];
    const variables = isRecord(body["variables"]) ? body["variables"] : {};
    let data: unknown;
    switch (operation) {
      case "AccessibleAgents":
        data = { accessibleAgentList: [] };
        break;
      case "ThreadAgentSessionList":
        data = {
          threadAgentSessionList: {
            nodes: variables["archived"]
              ? []
              : sessions.map((session) => ({ capabilities, session })),
            pageInfo: { endCursor: null, hasMore: false },
          },
        };
        break;
      case "ThreadAgentSessionRetrieve":
        data = {
          threadAgentSessionRetrieve: {
            capabilities,
            recoverability: { status: "available", reason: null },
            session: sessions.find((session) => session.id === variables["sessionId"]),
          },
        };
        break;
      case "ThreadSessionMessages":
        data = { threadSessionMessages: [] };
        break;
      case "ThreadSessionProcessEvents":
        data = { threadSessionProcessEvents: [] };
        break;
      case "AgentSessionProcessEvents":
      case "SessionProcessEvents":
        data = { sessionProcessEvents: [] };
        break;
      case "RestartSessionDriver":
      case "RecreateSessionSandbox":
        calls.push({ operation, variables });
        if (operation === "RecreateSessionSandbox" && !failedRecreate) {
          failedRecreate = true;
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              errors: [{ message: "Successful turn checkpoint is pending" }],
            }),
          });
          return;
        }
        data = {
          [operation === "RestartSessionDriver"
            ? "restartSessionDriver"
            : "recreateSessionSandbox"]: {
            affectedSessionCount: 1,
            ok: true,
            operation: operation === "RestartSessionDriver" ? "restartDriver" : "recreateSandbox",
            sessionId: variables["sessionId"],
          },
        };
        break;
      default:
        await route.fallback();
        return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
  });
  await page.goto(`/threads/${selected}`);
  const open = async (label: string) => {
    await page.getByRole("button", { name: "Session maintenance", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    return page.getByRole("dialog", { name: label, exact: true });
  };
  let dialog = await open("Restart execution");
  await expect(dialog).toContainText("only this session");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(calls).toEqual([]);
  dialog = await open("Restart execution");
  await dialog.getByRole("button", { name: "Restart execution", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  dialog = await open("Recreate environment");
  await dialog.getByRole("button", { name: "Recreate environment", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("checkpoint is pending");
  await dialog.getByRole("button", { name: "Recreate environment", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(calls).toEqual(
    ["RestartSessionDriver", "RecreateSessionSandbox", "RecreateSessionSandbox"].map(
      (operation) => ({
        operation,
        variables: { projectId: CONSOLE_FIXTURE_IDS.projectId, sessionId: selected },
      }),
    ),
  );
  mkdirSync(output, { recursive: true });
  dialog = await open("Recreate environment");
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: `${output}direct-session-maintenance.png`,
    fullPage: true,
    animations: "disabled",
  });
});
