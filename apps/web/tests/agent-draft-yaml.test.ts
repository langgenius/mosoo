import { describe, expect, test } from "bun:test";

import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";

import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import {
  createDraftYaml,
  createDraftYamlHash,
  createSnapshotHash,
  parseDraftYaml,
} from "../src/routes/agent/components/editor/draft";

function draft(): AgentEditorDraft {
  return {
    builtInTools: createDefaultAgentBuiltInTools().map((tool) =>
      tool.name === "bash" ? { ...tool, enabled: false } : tool,
    ),
    description: "Reviews releases before publish.",
    environmentId: "01J000000000000000000000E2",
    kind: "pet",
    mcpServers: [
      {
        credentialMode: "runtime_resolved",
        enabled: true,
        id: "01J000000000000000000000E3",
        name: "Linear MCP",
        source: "app",
        type: "web",
        url: "https://mcp.linear.app",
      },
    ],
    model: "gpt-5.4",
    name: "Release Review Agent",
    prompt: "Lead with blockers, then recommended fixes.",
    provider: "openai",
    providerOptions: {
      model_reasoning_effort: "high",
      model_verbosity: "medium",
    },
    runtime: "openai-runtime",
    skills: [
      {
        filename: "release-review.md",
        id: "01J000000000000000000000E4",
        name: "Release Review",
      },
    ],
  };
}

describe("agent draft YAML codec", () => {
  test("round-trips between YAML and the structured editor draft", () => {
    const current = draft();
    const yaml = createDraftYaml(current);
    const parsed = parseDraftYaml(yaml, current);

    expect(parsed).toEqual(current);
    expect(yaml).toContain("builtInTools:");
    expect(yaml).toContain("name: bash");
    expect(yaml).toContain("settings:");
    expect(yaml).toContain("model_reasoning_effort: high");
    expect(createDraftYamlHash(parsed)).toBe(createDraftYamlHash(current));
    expect(createSnapshotHash(parsed)).toBe(createSnapshotHash(current));
  });

  test("reads legacy providerOptions from Draft YAML", () => {
    const current = draft();
    const parsed = parseDraftYaml(
      [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Release Review Agent",
        "  description: Reviews releases before publish.",
        "runtime:",
        "  id: openai-runtime",
        "  provider: openai",
        "  model: gpt-5.4",
        "  providerOptions:",
        "    model_reasoning_effort: high",
      ].join("\n"),
      current,
    );

    expect(parsed.providerOptions).toEqual({
      model_reasoning_effort: "high",
    });
  });

  test("ignores legacy Builder metadata in Draft YAML", () => {
    const current = draft();
    const parsed = parseDraftYaml(
      [
        "version: 1",
        "kind: pet",
        "builder:",
        "  componentDecisions:",
        "    environment: skipped",
        "    mcpServers: skipped",
        "    skills: skipped",
      ].join("\n"),
      current,
    );

    expect(parsed).toEqual(current);
    expect(createSnapshotHash(parsed)).toBe(createSnapshotHash(current));
  });
});
