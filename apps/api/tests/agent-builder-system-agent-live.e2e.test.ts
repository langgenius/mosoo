import { describe, test } from "bun:test";

import { parseAgentBuilderPlannerOutput } from "@mosoo/contracts/agent-builder";

import { submitAgentBuilderSystemAgentMessage } from "../src/modules/agent-builder/application/agent-builder-system-agent-rpc.service";
import { createAgentBuilderSystemAgentSubmitRuntime } from "../src/modules/agent-builder/application/agent-builder-system-agent-runtime.service";
import {
  ensureAgentBuilderThread,
  listAgentBuilderMessages,
} from "../src/modules/agent-builder/application/agent-builder-thread.service";
import {
  createAgentBuilderApiFixture,
  insertAgentBuilderVendorCredential,
} from "./helpers/agent-builder-api-fixture";

const openAiApiKey = process.env["MOSOO_E2E_OPENAI_API_KEY"]?.trim() ?? "";
const openAiModel = process.env["MOSOO_E2E_OPENAI_MODEL"]?.trim() ?? "";
const requireLivePlanner = process.env["MOSOO_E2E_REQUIRE_LIVE_PLANNER"] === "1";
const hasLivePlannerEnv = openAiApiKey.length > 0 && openAiModel.length > 0;

if (requireLivePlanner && !hasLivePlannerEnv) {
  throw new Error(
    "MOSOO_E2E_REQUIRE_LIVE_PLANNER=1 requires MOSOO_E2E_OPENAI_API_KEY and MOSOO_E2E_OPENAI_MODEL.",
  );
}

const livePlannerTest = hasLivePlannerEnv ? test : test.skip;

const DRAFT_YAML = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Slack Support Bot",
  "  description: Triage customer support messages in Slack.",
  "runtime:",
  "  id: claude-agent-sdk",
  "  provider: anthropic",
  "  model: claude-sonnet-4-5",
  "prompt: Triage Slack support messages and write concise replies.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
].join("\n");

async function loginAndReadViewer(input: Awaited<ReturnType<typeof createAgentBuilderApiFixture>>) {
  await input.client.loginAsMosooAiTestAccount();
  const viewer = await input.client.readAuthenticatedViewerFromSession();

  if (viewer === null) {
    throw new Error("Expected Agent Builder live e2e viewer session.");
  }

  return viewer;
}

describe("Agent Builder live System Agent planner e2e", () => {
  livePlannerTest("accepts real OpenAI planner output as structured Builder output", async () => {
    const fixture = await createAgentBuilderApiFixture();
    await fixture.bindings.DB.prepare("UPDATE account SET system_agent_model = ? WHERE id = ?")
      .bind(JSON.stringify({ modelId: openAiModel, vendor: "openai" }), fixture.viewer.id)
      .run();
    await insertAgentBuilderVendorCredential(fixture, {
      apiKey: openAiApiKey,
      vendorId: "openai",
    });

    const viewer = await loginAndReadViewer(fixture);
    const thread = await ensureAgentBuilderThread(fixture.bindings.DB, viewer, fixture.ids.agentId);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-live-openai",
      draftYaml: DRAFT_YAML,
      inputText:
        "Please inspect the current Manifest and return one concise structured Builder output. If anything is unclear, ask one focused question.",
      runtime: createAgentBuilderSystemAgentSubmitRuntime({
        bindings: fixture.bindings,
        viewer,
      }),
      threadId: thread.id,
    });

    const assistantMessage = result.messages.at(-1);
    const output = parseAgentBuilderPlannerOutput(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );

    if (output === null) {
      throw new Error("Live Agent Builder planner did not return parseable structured output.");
    }

    if (output.mode === "blocked") {
      const blockedNode = output.nodes[0];
      throw new Error(
        [
          "Live Agent Builder planner returned a blocked output:",
          blockedNode?.nodeKey ?? "unknown",
          blockedNode?.summary ?? "missing blocked summary",
        ].join(" "),
      );
    }

    if (output.nodes.length === 0) {
      throw new Error("Live Agent Builder planner returned no structured nodes.");
    }

    const plannerRunId = assistantMessage?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Live Agent Builder planner did not persist a planner run id.");
    }

    const plannerRunRow = await fixture.bindings.DB.prepare(
      "SELECT model, output_json, provider, status FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{
        model: string;
        output_json: string | null;
        provider: string;
        status: string;
      }>();

    if (plannerRunRow === null) {
      throw new Error("Live Agent Builder planner run was not persisted.");
    }

    if (plannerRunRow.provider !== "openai") {
      throw new Error(`Expected OpenAI live planner provider, received ${plannerRunRow.provider}.`);
    }

    if (plannerRunRow.model !== openAiModel) {
      throw new Error(
        "Live Agent Builder planner used a model different from the requested model.",
      );
    }

    if (plannerRunRow.status !== "completed") {
      throw new Error(`Live Agent Builder planner run did not complete: ${plannerRunRow.status}.`);
    }

    if (plannerRunRow.output_json !== assistantMessage?.cardsJson) {
      throw new Error("Live Agent Builder planner output differs from assistant message cards.");
    }

    const persistedOutput = parseAgentBuilderPlannerOutput(
      JSON.parse(plannerRunRow.output_json ?? "null"),
    );

    if (persistedOutput?.plannerRunId !== plannerRunId) {
      throw new Error("Live Agent Builder planner output does not reference the persisted run.");
    }

    const messages = await listAgentBuilderMessages(fixture.bindings.DB, viewer, {
      agentId: fixture.ids.agentId,
    });

    if (messages.length < 2) {
      throw new Error("Live Agent Builder planner did not persist the Builder turn.");
    }
  });
});
