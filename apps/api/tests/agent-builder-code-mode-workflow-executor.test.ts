import { describe, expect, test } from "bun:test";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { createCodeModeBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-code-mode-workflow-executor.service";
import type { CloudflareCodeModeModuleLoader } from "../src/modules/agent-builder/application/builder-code-mode-workflow-executor.service";

function createTestLoader(): WorkerLoader {
  return {} as WorkerLoader;
}

function createRuntime() {
  return createAgentBuilderToolRuntime({
    now: () => "2026-05-25T00:00:00.000Z",
    tools: [
      {
        async execute(input) {
          return {
            items: [{ id: "skill_1", name: input["query"] ?? "unknown" }],
            mode: "asset_search",
          };
        },
        toolId: "search_assets",
      },
    ],
  });
}

function createModuleLoader(
  execute: (
    code: string,
    providers: Array<{
      readonly fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
      readonly name: string;
    }>,
  ) => Promise<{
    error?: string;
    logs?: string[];
    result: unknown;
  }>,
  inspectOptions?: (options: {
    readonly globalOutbound: Fetcher | null;
    readonly loader: WorkerLoader;
    readonly timeout: number;
  }) => void,
): CloudflareCodeModeModuleLoader {
  return async () => ({
    DynamicWorkerExecutor: class {
      readonly options: {
        readonly globalOutbound: Fetcher | null;
        readonly loader: WorkerLoader;
        readonly timeout: number;
      };

      constructor(options: {
        readonly globalOutbound: Fetcher | null;
        readonly loader: WorkerLoader;
        readonly timeout: number;
      }) {
        this.options = options;
      }

      async execute(
        code: string,
        providers: Array<{
          readonly fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
          readonly name: string;
        }>,
      ) {
        if (this.options.globalOutbound !== null) {
          throw new Error("Code Mode executor must not receive global outbound fetch access.");
        }
        inspectOptions?.(this.options);

        return execute(code, providers);
      }
    },
  });
}

describe("Agent Builder Code Mode workflow executor", () => {
  test("runs code through DynamicWorkerExecutor and records host tool trace", async () => {
    const loader = createTestLoader();
    const executor = createCodeModeBuilderWorkflowExecutor({
      loadCodeModeModule: createModuleLoader(
        async (_code, providers) => {
          expect(providers.map((provider) => provider.name)).toEqual(["builder"]);
          const fns = providers[0]?.fns ?? {};
          const searchResult = await fns["search_assets"]?.({ query: "Linear" });

          return {
            logs: ["searched Linear"],
            result: {
              mode: "starter_pack",
              searchResult,
            },
          };
        },
        (options) => {
          expect(options.loader).toBe(loader);
          expect(options.timeout).toBe(1_000);
        },
      ),
      loader,
    });
    const result = await executor.execute({
      code: "async () => builder.search_assets({ query: 'Linear' })",
      timeoutMs: 1_000,
      tools: createRuntime(),
    });

    expect(result.errorMessage).toBeNull();
    expect(result.logs).toEqual(["searched Linear"]);
    expect(result.trace.map((entry) => entry.requestedToolId)).toEqual(["search_assets"]);
    expect(result.trace[0]?.status).toBe("completed");
    expect(result.result).toMatchObject({
      mode: "starter_pack",
      searchResult: {
        items: [{ id: "skill_1", name: "Linear" }],
      },
    });
  });

  test("maps Code Mode sandbox errors without throwing", async () => {
    const executor = createCodeModeBuilderWorkflowExecutor({
      loadCodeModeModule: createModuleLoader(async () => ({
        error: "sandbox timed out",
        logs: ["before timeout"],
        result: null,
      })),
      loader: createTestLoader(),
    });
    const result = await executor.execute({
      code: "async () => { while (true) {} }",
      timeoutMs: 1_000,
      tools: createRuntime(),
    });

    expect(result).toMatchObject({
      errorMessage: "sandbox timed out",
      logs: ["before timeout"],
      result: null,
      trace: [],
    });
  });

  test("maps host tool failures into workflow errors and keeps the attempted trace", async () => {
    const executor = createCodeModeBuilderWorkflowExecutor({
      loadCodeModeModule: createModuleLoader(async (_code, providers) => {
        const fns = providers[0]?.fns ?? {};
        await fns["get_asset_detail"]?.({});

        return {
          result: null,
        };
      }),
      loader: createTestLoader(),
    });
    const result = await executor.execute({
      code: "async () => builder.get_asset_detail({})",
      timeoutMs: 1_000,
      tools: createRuntime(),
    });

    expect(result.errorMessage).toContain("get_asset_detail");
    expect(result.result).toBeNull();
    expect(result.trace.map((entry) => entry.requestedToolId)).toEqual(["get_asset_detail"]);
    expect(result.trace[0]?.status).toBe("failed");
  });
});
