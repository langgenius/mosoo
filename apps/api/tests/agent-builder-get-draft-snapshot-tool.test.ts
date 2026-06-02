import { describe, expect, test } from "bun:test";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { createGetDraftSnapshotTool } from "../src/modules/agent-builder/application/tools/get-draft-snapshot.tool";

const SNAPSHOT_IDS = {
  channel: "01J00000000000000000000201",
  environment: "01J00000000000000000000202",
  mcpServer: "01J00000000000000000000203",
  skill: "01J00000000000000000000204",
  space: "01J00000000000000000000205",
} as const;

const draftYaml = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Triage Agent",
  "  description: Helps triage GitHub issues.",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Sort new issues by urgency.",
  "environment:",
  `  environmentId: ${SNAPSHOT_IDS.environment}`,
  "assets:",
  "  agentsFileId: null",
  "  skills:",
  `    - ${SNAPSHOT_IDS.skill}`,
  "  mcpServers:",
  `    - ${SNAPSHOT_IDS.mcpServer}`,
  "  spaces:",
  `    - id: ${SNAPSHOT_IDS.space}`,
  "      name: Support KB",
  "channels:",
  "  providers:",
  `    - ${SNAPSHOT_IDS.channel}`,
].join("\n");

describe("get_draft_snapshot tool", () => {
  test("returns a parsed Draft snapshot without mutating state", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: () => "2026-05-20T00:00:00.000Z",
      tools: [createGetDraftSnapshotTool()],
    });

    const result = await runtime.execute({
      input: {
        draftRevision: "rev_1",
        draftYaml,
      },
      toolId: "get_draft_snapshot",
    });
    const inputSummary = result.redactedInputSummary;

    expect(result).toMatchObject({
      errorMessage: null,
      output: {
        channelIds: [SNAPSHOT_IDS.channel],
        description: "Helps triage GitHub issues.",
        draftRevision: "rev_1",
        draftYamlLength: draftYaml.length,
        environmentId: SNAPSHOT_IDS.environment,
        mcpServerIds: [SNAPSHOT_IDS.mcpServer],
        mcpServersRepresented: true,
        model: "gpt-5.4",
        name: "Triage Agent",
        parseError: null,
        parseStatus: "parsed",
        prompt: "Sort new issues by urgency.",
        provider: "openai",
        runtimeId: "openai-runtime",
        skillIds: [SNAPSHOT_IDS.skill],
        spaceIds: [SNAPSHOT_IDS.space],
      },
      status: "completed",
      toolId: "get_draft_snapshot",
    });
    expect(typeof inputSummary).toBe("string");
    if (typeof inputSummary !== "string") {
      throw new Error("Expected redacted Draft snapshot input summary.");
    }
    expect(inputSummary.length).toBeGreaterThan(0);
    expect(inputSummary).not.toContain("rev_1");
    expect(inputSummary).not.toContain("Triage Agent");
    expect(inputSummary).not.toContain("Sort new issues");
  });

  test("fails when required Draft input is missing", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: () => "2026-05-20T00:00:00.000Z",
      tools: [createGetDraftSnapshotTool()],
    });

    const result = await runtime.execute({
      input: { draftRevision: "rev_1" },
      toolId: "get_draft_snapshot",
    });
    const inputSummary = result.redactedInputSummary;

    expect(result).toMatchObject({
      errorMessage: expect.stringContaining("draftYaml"),
      output: null,
      status: "failed",
      toolId: "get_draft_snapshot",
    });
    expect(typeof inputSummary).toBe("string");
    if (typeof inputSummary !== "string") {
      throw new Error("Expected redacted Draft snapshot input summary.");
    }
    expect(inputSummary.length).toBeGreaterThan(0);
    expect(inputSummary).not.toContain("rev_1");
  });
});
