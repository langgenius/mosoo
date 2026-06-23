import { describe, expect, test } from "bun:test";

import type { AgentEditorDraft } from "../src/routes/agent/components/editor/draft";
import {
  createDraftYaml,
  createDraftYamlHash,
  createSnapshotHash,
  parseDraftYaml,
} from "../src/routes/agent/components/editor/draft";

function draft(): AgentEditorDraft {
  return {
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
      features: {
        web_search: true,
      },
      reasoning_effort: "high",
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
    expect(yaml).toContain("providerOptions:");
    expect(yaml).toContain("reasoning_effort: high");
    expect(createDraftYamlHash(parsed)).toBe(createDraftYamlHash(current));
    expect(createSnapshotHash(parsed)).toBe(createSnapshotHash(current));
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
