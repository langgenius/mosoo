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
    componentDecisions: {},
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
    spaces: [{ id: "01J000000000000000000000E5", name: "Release Space" }],
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

  test("round-trips Builder component decisions without changing runtime config snapshot", () => {
    const current = {
      ...draft(),
      componentDecisions: {
        environment: "skipped" as const,
      },
      environmentId: null,
    };
    const yaml = createDraftYaml(current);
    const parsed = parseDraftYaml(yaml, draft());

    expect(yaml).toContain("componentDecisions:");
    expect(parsed.componentDecisions.environment).toBe("skipped");
    expect(createSnapshotHash(parsed)).toBe(
      createSnapshotHash({ ...parsed, componentDecisions: {} }),
    );
  });

  test("ignores unsupported component decision keys in Draft YAML", () => {
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
        "    spaces: skipped",
      ].join("\n"),
      current,
    );

    expect(parsed.componentDecisions).toEqual({ environment: "skipped" });
  });

  test("clears Environment component decision when the Draft YAML omits Builder metadata", () => {
    const current = {
      ...draft(),
      componentDecisions: {
        environment: "skipped" as const,
      },
    };
    const yaml = createDraftYaml({ ...current, componentDecisions: {} });
    const parsed = parseDraftYaml(yaml, current);

    expect(yaml).not.toContain("componentDecisions:");
    expect(parsed.componentDecisions).toEqual({});
  });
});
