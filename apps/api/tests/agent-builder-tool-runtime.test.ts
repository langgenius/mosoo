import { describe, expect, test } from "bun:test";

import {
  createAgentBuilderToolRuntime,
  summarizeAgentBuilderToolPayload,
} from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";

function createDeterministicClock(): () => string {
  let tick = 0;

  return () => {
    tick += 1;
    return `2026-05-20T00:00:0${tick}.000Z`;
  };
}

describe("Agent Builder tool runtime", () => {
  test("summarizes payload shape without exposing values", () => {
    const summary = summarizeAgentBuilderToolPayload({
      draftYaml: "secret draft content",
      enabled: true,
      ids: ["space_1", "space_2"],
      revision: "rev_1",
    });

    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toContain("secret draft content");
    expect(summary).not.toContain("space_1");
    expect(summary).not.toContain("rev_1");
  });

  test("executes a registered read tool and records a structured trace", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createDeterministicClock(),
      tools: [
        {
          execute(input) {
            return {
              draftYamlLength:
                typeof input["draftYaml"] === "string" ? input["draftYaml"].length : 0,
              revision: input["revision"],
            };
          },
          toolId: "get_draft_snapshot",
        },
      ],
    });

    const result = await runtime.execute({
      input: {
        draftYaml: "version: 1",
        revision: "rev_1",
      },
      toolId: "get_draft_snapshot",
    });
    const inputSummary = result.redactedInputSummary;
    const outputSummary = result.redactedOutputSummary;

    expect(result).toMatchObject({
      completedAt: "2026-05-20T00:00:02.000Z",
      errorMessage: null,
      input: {
        draftYaml: "version: 1",
        revision: "rev_1",
      },
      output: {
        draftYamlLength: 10,
        revision: "rev_1",
      },
      requestedToolId: "get_draft_snapshot",
      startedAt: "2026-05-20T00:00:01.000Z",
      status: "completed",
      toolId: "get_draft_snapshot",
    });
    expect(typeof inputSummary).toBe("string");
    expect(typeof outputSummary).toBe("string");
    if (typeof inputSummary !== "string" || typeof outputSummary !== "string") {
      throw new Error("Expected redacted tool summaries.");
    }
    expect(inputSummary.length).toBeGreaterThan(0);
    expect(inputSummary).not.toContain("version: 1");
    expect(inputSummary).not.toContain("rev_1");
    expect(outputSummary.length).toBeGreaterThan(0);
    expect(outputSummary).not.toContain("rev_1");
  });

  test("fails unknown tool requests without throwing", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createDeterministicClock(),
      tools: [],
    });

    const result = await runtime.execute({
      input: { query: "github" },
      toolId: "missing_tool",
    });
    const inputSummary = result.redactedInputSummary;

    expect(result).toMatchObject({
      errorMessage: expect.stringContaining("missing_tool"),
      output: null,
      requestedToolId: "missing_tool",
      status: "failed",
      toolId: null,
    });
    expect(typeof inputSummary).toBe("string");
    if (typeof inputSummary !== "string") {
      throw new Error("Expected redacted tool input summary.");
    }
    expect(inputSummary.length).toBeGreaterThan(0);
    expect(inputSummary).not.toContain("github");
  });

  test("fails known but unregistered tools without throwing", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createDeterministicClock(),
      tools: [],
    });

    const result = await runtime.execute({
      input: { query: "github" },
      toolId: "search_assets",
    });
    const inputSummary = result.redactedInputSummary;

    expect(result).toMatchObject({
      errorMessage: expect.stringContaining("search_assets"),
      output: null,
      requestedToolId: "search_assets",
      status: "failed",
      toolId: "search_assets",
    });
    expect(typeof inputSummary).toBe("string");
    if (typeof inputSummary !== "string") {
      throw new Error("Expected redacted tool input summary.");
    }
    expect(inputSummary.length).toBeGreaterThan(0);
    expect(inputSummary).not.toContain("github");
  });
});
