import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { CONSOLE_FIXTURE_IDS, installConsoleFixtures } from "../../lib/console-fixtures";

const output = fileURLToPath(new URL("../../../.tmp/e2e/session-isolation/", import.meta.url));
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
      status: "draft",
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
    await expect
      .poll(() => writes.some((write) => write["prompt"] === "Edited durable instructions."))
      .toBe(true);
    expect(agent.kind).toBe(kind);
    mkdirSync(output, { recursive: true });
    await page.screenshot({ path: `${output}${kind}-editor.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
