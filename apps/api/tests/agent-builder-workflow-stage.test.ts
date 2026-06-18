import { describe, expect, test } from "bun:test";

import { toAgentBuilderWorkflowDraftSnapshot } from "../src/modules/agent-builder/application/agent-builder-lightweight-manifest-projections";
import { deriveAgentBuilderWorkflowState } from "../src/modules/agent-builder/application/agent-builder-workflow-stage.service";

const COMPLETE_BASE_DRAFT = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Slack Support Bot",
  "  description: Triage customer support messages in Slack.",
  "runtime:",
  "  id: cloudflare-agents-sdk",
  "  provider: anthropic",
  "  model: claude-sonnet-4-5",
  "prompt: Triage Slack support messages and write concise replies.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
].join("\n");

const DRAFT_WITH_SKIPPED_ENVIRONMENT = [
  ...COMPLETE_BASE_DRAFT.split("\n"),
  "builder:",
  "  componentDecisions:",
  "    environment: skipped",
].join("\n");

describe("Agent Builder workflow stage", () => {
  test("parses Agent type as a first-class Manifest field", () => {
    expect(toAgentBuilderWorkflowDraftSnapshot(COMPLETE_BASE_DRAFT).kind).toBe("pet");
  });

  test("keeps Step 1 active until all create-agent Manifest fields are present", () => {
    const state = deriveAgentBuilderWorkflowState({
      draft: toAgentBuilderWorkflowDraftSnapshot("version: 1\nkind: pet\n"),
      preview: { messageCount: 0, opened: false, sessionExists: false },
    });

    expect(state.activeStageId).toBe("create_agent");
    expect(state.steps.createAgent.status).toBe("active");
    expect(state.steps.createAgent.missingFields).toEqual([
      "name",
      "description",
      "runtimeId",
      "provider",
      "model",
      "prompt",
    ]);
  });

  test("requires an Environment decision in Step 2 but does not block on optional assets", () => {
    const state = deriveAgentBuilderWorkflowState({
      draft: toAgentBuilderWorkflowDraftSnapshot(COMPLETE_BASE_DRAFT),
      preview: { messageCount: 0, opened: false, sessionExists: false },
    });

    expect(state.activeStageId).toBe("configure_components");
    expect(state.steps.createAgent.status).toBe("completed");
    expect(state.steps.configureComponents.status).toBe("active");
    expect(state.steps.configureComponents.blockingMissingItems).toEqual(["environment"]);
    expect(state.steps.configureComponents.optionalItems).toEqual(["skills", "mcp_servers"]);
    expect(state.nextAction.kind).toBe("configure_environment");
  });

  test("uses Manifest component decisions as durable Step 2 progress", () => {
    const state = deriveAgentBuilderWorkflowState({
      draft: toAgentBuilderWorkflowDraftSnapshot(DRAFT_WITH_SKIPPED_ENVIRONMENT),
      preview: { messageCount: 0, opened: false, sessionExists: false },
    });

    expect(state.activeStageId).toBe("configure_components");
    expect(state.steps.configureComponents.status).toBe("active");
    expect(state.steps.configureComponents.blockingMissingItems).toEqual([]);
    expect(state.nextAction.kind).toBe("open_preview");
  });

  test("opens Preview as Step 3 without creating a Session until a real preview action occurs", () => {
    const state = deriveAgentBuilderWorkflowState({
      draft: toAgentBuilderWorkflowDraftSnapshot(DRAFT_WITH_SKIPPED_ENVIRONMENT),
      preview: { messageCount: 0, opened: true, sessionExists: false },
    });

    expect(state.activeStageId).toBe("preview");
    expect(state.steps.configureComponents.status).toBe("completed");
    expect(state.steps.preview.status).toBe("active");
    expect(state.steps.preview.sessionStarted).toBe(false);
  });

  test("completes Step 3 and enters refine mode after the reused preview Session has real chat history", () => {
    const state = deriveAgentBuilderWorkflowState({
      draft: toAgentBuilderWorkflowDraftSnapshot(DRAFT_WITH_SKIPPED_ENVIRONMENT),
      preview: { messageCount: 2, opened: true, sessionExists: true },
    });

    expect(state.activeStageId).toBe("refine");
    expect(state.steps.preview.status).toBe("completed");
    expect(state.steps.preview.sessionStarted).toBe(true);
    expect(state.steps.refine.status).toBe("active");
  });
});
