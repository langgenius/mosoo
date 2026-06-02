import { describe, expect, test } from "bun:test";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { createDeterministicBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-workflow-executor.service";

function createStaticNow(): () => string {
  return () => "2026-05-25T00:00:00.000Z";
}

describe("Agent Builder workflow executor", () => {
  test("runs a deterministic workflow and records tool trace", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createStaticNow(),
      tools: [
        {
          execute(input) {
            return {
              items: [{ id: "skill_1", name: input["query"] }],
              mode: "asset_search",
            };
          },
          toolId: "search_assets",
        },
      ],
    });

    const executor = createDeterministicBuilderWorkflowExecutor(async (context) => {
      context.log("searching existing assets");
      const output = await context.callTool({
        input: { query: "Linear" },
        toolId: "search_assets",
      });

      return {
        mode: "starter_pack",
        output,
      };
    });

    const result = await executor.execute({
      code: "deterministic test workflow",
      timeoutMs: 1_000,
      tools: runtime,
    });

    expect(result.errorMessage).toBeNull();
    expect(result.logs).toEqual(["searching existing assets"]);
    expect(result.result).toEqual({
      mode: "starter_pack",
      output: {
        items: [{ id: "skill_1", name: "Linear" }],
        mode: "asset_search",
      },
    });
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]?.requestedToolId).toBe("search_assets");
    expect(result.trace[0]?.status).toBe("completed");
  });

  test("returns a workflow error and keeps failed tool trace", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createStaticNow(),
      tools: [],
    });
    const executor = createDeterministicBuilderWorkflowExecutor(async (context) => {
      await context.callTool({
        toolId: "search_assets",
      });
    });

    const result = await executor.execute({
      code: "deterministic test workflow",
      timeoutMs: 1_000,
      tools: runtime,
    });

    expect(result.errorMessage).toContain("search_assets");
    expect(result.result).toBeNull();
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]?.requestedToolId).toBe("search_assets");
    expect(result.trace[0]?.status).toBe("failed");
  });

  test("rejects invalid timeouts before running the workflow", async () => {
    let didRun = false;
    const runtime = createAgentBuilderToolRuntime({
      now: createStaticNow(),
      tools: [],
    });
    const executor = createDeterministicBuilderWorkflowExecutor(() => {
      didRun = true;
      return null;
    });

    const result = await executor.execute({
      code: "deterministic test workflow",
      timeoutMs: 0,
      tools: runtime,
    });

    expect(didRun).toBe(false);
    expect(result.errorMessage).toContain("timeoutMs");
    expect(result.trace).toEqual([]);
  });

  test("times out a slow workflow", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createStaticNow(),
      tools: [],
    });
    const executor = createDeterministicBuilderWorkflowExecutor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "late";
    });

    const result = await executor.execute({
      code: "deterministic test workflow",
      timeoutMs: 1,
      tools: runtime,
    });

    expect(result.errorMessage).toContain("timed out");
    expect(result.result).toBeNull();
  });
});
