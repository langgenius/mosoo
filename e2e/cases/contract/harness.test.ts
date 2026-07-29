import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { e2eCases } from "../../cases";
import { matchE2ERunTarget } from "../../cli-targets";
import { loadRepoEnv } from "../../env";
import {
  requirePreviewRuntimeCredential,
  requireProviderRuntimeEnv,
} from "../../lib/env-preflight";
import {
  assertRuntimeSignalCoverage,
  createLatencyProbe,
  createRuntimeSignalCollector,
  summarizeRuntimeSignalCoverage,
} from "../../lib/runtime-progress";
import type { RuntimeHarnessSignal } from "../../lib/runtime-progress";

const observedAt = "2026-05-18T08:00:00.000Z";
const ENV_KEYS = [
  "MOSOO_E2E_ANTHROPIC_API_KEY",
  "MOSOO_E2E_OPENAI_API_KEY",
  "MOSOO_E2E_PROVIDER",
  "MOSOO_E2E_PROVIDER_API_KEY",
] as const;

function commandNames(target: NonNullable<ReturnType<typeof matchE2ERunTarget>>): string[] {
  return target.entries.map((entry) => entry.id.join(" "));
}

async function runCli(args: readonly string[]): Promise<{
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const process = Bun.spawn({
    cmd: ["bun", "e2e/cli.ts", ...args],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { exitCode, stderr, stdout };
}

function signal(category: RuntimeHarnessSignal["category"], name: string): RuntimeHarnessSignal {
  return {
    category,
    name,
    observedAt,
    source: "runtime-progress.test",
  };
}

class FakePage extends EventEmitter {
  url(): string {
    return "http://localhost:5173/agent/agent-1?tab=preview";
  }
}

class FakeWebSocket extends EventEmitter {
  private readonly socketUrl: string;

  constructor(socketUrl: string) {
    super();
    this.socketUrl = socketUrl;
  }

  url(): string {
    return this.socketUrl;
  }
}

async function withEnvFile<T>(content: string, run: (path: string) => T | Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mosoo-e2e-env-"));
  const path = join(dir, ".env");

  try {
    await Bun.write(path, content);
    return await run(path);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

function withProcessEnv<T>(env: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function withPreviewEnv<T>(
  env: Record<(typeof ENV_KEYS)[number], string | undefined>,
  run: () => T,
): T {
  return withProcessEnv(env, run);
}

describe("E2E CLI target matching", () => {
  test("returns null for an empty layer when invoked with the layer name", () => {
    const target = matchE2ERunTarget(e2eCases, ["api"]);

    expect(target).toBeNull();
  });

  test("keeps exact case matching more specific than layer matching", () => {
    const target = matchE2ERunTarget(e2eCases, ["public-api", "runtime", "--", "--list"]);

    expect(target?.label).toBe("public-api runtime");
    expect(target?.args).toEqual(["--list"]);
    expect(target === null ? [] : commandNames(target)).toEqual(["public-api runtime"]);
  });

  test("requires the complete isolated A/B staging configuration for cold-start crossover", () => {
    const benchmark = e2eCases.find((entry) => entry.id.join(" ") === "public-api cold-start-ab");

    expect(benchmark?.description).toContain("dual-stack");
    expect(benchmark?.requiresEnv).toEqual(
      expect.arrayContaining([
        "CLOUDFLARE_ACCOUNT_ID",
        "MOSOO_PERF_FIXTURE_A",
        "MOSOO_PERF_FIXTURE_B",
        "MOSOO_PERF_BEFORE_CONTAINER_INSTANCE_TYPE",
        "MOSOO_PERF_BEFORE_CONTAINER_VCPU",
        "MOSOO_PERF_BEFORE_CONTAINER_MEMORY_MIB",
        "MOSOO_PERF_BEFORE_CONTAINER_DISK_MB",
        "MOSOO_PERF_BEFORE_CONTAINER_MAX_INSTANCES",
        "MOSOO_PERF_AFTER_CONTAINER_INSTANCE_TYPE",
        "MOSOO_PERF_AFTER_CONTAINER_VCPU",
        "MOSOO_PERF_AFTER_CONTAINER_MEMORY_MIB",
        "MOSOO_PERF_AFTER_CONTAINER_DISK_MB",
        "MOSOO_PERF_AFTER_CONTAINER_MAX_INSTANCES",
        "MOSOO_PERF_A_CF_ENV",
        "MOSOO_PERF_A_RESOURCE_PREFIX",
        "MOSOO_PERF_A_WRANGLER_TEMPLATE",
        "MOSOO_PERF_B_CF_ENV",
        "MOSOO_PERF_B_RESOURCE_PREFIX",
        "MOSOO_PERF_B_WRANGLER_TEMPLATE",
      ]),
    );
    expect(benchmark?.requiresEnv).not.toContain("MOSOO_PERF_FIXTURE");
    expect(benchmark?.requiresEnv).not.toContain("MOSOO_PERF_BASE_URL");
  });
});

describe("E2E CLI help", () => {
  test("prints compact case table columns without requirements", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Command");
    expect(result.stdout).toContain("Layer");
    expect(result.stdout).toContain("Description");
    expect(result.stdout).not.toContain("Requires");
    expect(result.stdout).not.toContain("MOSOO_E2E_PROVIDER_API_KEY");
  });

  test("does not expose list as a command", async () => {
    const result = await runCli(["list"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown E2E target: list");
  });
});

describe("runtime signal coverage contract", () => {
  test("fails with an agent-oriented message when a required category is missing", () => {
    const signals = [signal("application_lifecycle", "browser.load")];

    expect(() => assertRuntimeSignalCoverage(signals)).toThrow(
      /WHAT: Runtime signal collection is missing required coverage:/,
    );
    expect(() => assertRuntimeSignalCoverage(signals)).toThrow(/feature_path_execution/);
  });

  test("passes when the harness covers lifecycle, feature path, data flow, resources, and errors", () => {
    const signals = [
      signal("application_lifecycle", "browser.load"),
      signal("feature_path_execution", "session-log.entry"),
      signal("data_flow", "graphql.AgentSessionDiagnostics"),
      signal("resource_utilization", "browser.heap.sample"),
      signal("errors_exceptions", "browser.error.collector_installed"),
    ];

    const summary = summarizeRuntimeSignalCoverage(signals);

    expect(summary.missingCategories).toEqual([]);
    expect(() => assertRuntimeSignalCoverage(signals)).not.toThrow();
  });

  test("records websocket activity without depending on endpoint or frame internals", () => {
    const collector = createRuntimeSignalCollector({
      source: "runtime-progress.test",
    });
    const page = new FakePage();

    collector.attachToPage(page);

    const socket = new FakeWebSocket("ws://localhost:5173/runtime-stream");
    page.emit("websocket", socket);
    socket.emit("framereceived", {
      payload: "opaque-frame-payload",
    });
    socket.emit("socketerror", "stream failed");
    socket.emit("close");

    expect(collector.getSignals().some((item) => item.category === "data_flow")).toBe(true);
    expect(collector.getSignals()).toContainEqual(
      expect.objectContaining({
        category: "errors_exceptions",
      }),
    );
    expect(collector.getSignals()).toContainEqual(
      expect.objectContaining({
        category: "application_lifecycle",
      }),
    );
  });

  test("measures input, Send click, first assistant delta, and first paint independently", async () => {
    let nowEpochMs = 2_000;
    const page = new FakePage();
    const probe = createLatencyProbe({
      nowEpochMs: () => nowEpochMs,
      page,
    });
    const socket = new FakeWebSocket(
      "ws://localhost:5173/api/ag-ui/session/session-1/ws?appId=app-1",
    );
    page.emit("websocket", socket);

    const turn = probe.startTurn("measured-turn");
    turn.markSendClick(2_000);
    socket.emit("framereceived", {
      payload: JSON.stringify({
        messageId: "user-1",
        role: "user",
        type: "TEXT_MESSAGE_START",
      }),
    });
    socket.emit("framereceived", {
      payload: JSON.stringify({
        delta: "ignored",
        messageId: "user-1",
        type: "TEXT_MESSAGE_CONTENT",
      }),
    });
    socket.emit("framereceived", {
      payload: JSON.stringify({
        messageId: "assistant-1",
        role: "assistant",
        type: "TEXT_MESSAGE_START",
      }),
    });
    socket.emit("framereceived", {
      payload: JSON.stringify({
        delta: "",
        messageId: "assistant-1",
        type: "TEXT_MESSAGE_CONTENT",
      }),
    });
    nowEpochMs = 2_300;
    socket.emit("framereceived", {
      payload: JSON.stringify({
        delta: "first token",
        messageId: "assistant-1",
        type: "TEXT_MESSAGE_CONTENT",
      }),
    });

    const latency = await turn.wait({
      firstPaintAtEpochMs: Promise.resolve(2_800),
      inputStartedAtEpochMs: 1_000,
      visibleText: Promise.resolve(700),
    });

    expect(latency).toMatchObject({
      clickToFirstAssistantDeltaMs: 300,
      clickToFirstPaintMs: 800,
      firstAssistantTextMs: 700,
      inputToClickMs: 1_000,
      inputToFirstPaintMs: 1_800,
    });
  });

  test("emits concise progress lines for feature checkpoints when enabled", () => {
    const lines: string[] = [];
    let now = 1_000;
    const collector = createRuntimeSignalCollector({
      progress: {
        now: () => now,
        write: (line) => lines.push(line),
      },
      source: "preview-smoke",
    });

    collector.attachToPage(new FakePage());
    collector.checkpoint("preview.login.start", {
      email: "preview-smoke@example.test",
      nested: { hidden: "value" },
    });
    now = 2_250;
    collector.checkpoint("preview.agent.create.done", {
      agentId: "01KV0000000000000000000000",
      retries: 0,
    });

    expect(lines).toEqual([
      '[preview-smoke] 0.0s preview.login.start email="preview-smoke@example.test" nested={...}',
      '[preview-smoke] 1.3s preview.agent.create.done agentId="01KV0000000000000000000000" retries=0',
    ]);
  });

  test("allows API-only harnesses to scope required coverage categories", () => {
    const collector = createRuntimeSignalCollector({
      source: "public-api-runtime",
    });

    collector.checkpoint("public-api.thread.created");

    expect(() =>
      collector.assertCoverage({
        requiredCategories: ["feature_path_execution"],
      }),
    ).not.toThrow();
  });
});

describe("E2E environment loader", () => {
  test("loads repo env file values", async () => {
    await withEnvFile(
      [
        "MOSOO_E2E_PROVIDER=anthropic",
        "MOSOO_E2E_PROVIDER_API_KEY='provider-key'",
        'MOSOO_E2E_BASE_URL="http://localhost:5174"',
        "WEB_DEV_PORT = 5174",
      ].join("\n"),
      (path) => {
        const env = {
          MOSOO_ENV_FILE: path,
        };

        loadRepoEnv({ env });

        expect(env).toMatchObject({
          MOSOO_E2E_BASE_URL: "http://localhost:5174",
          MOSOO_E2E_PROVIDER: "anthropic",
          MOSOO_E2E_PROVIDER_API_KEY: "provider-key",
          WEB_DEV_PORT: "5174",
        });
      },
    );
  });

  test("keeps shell environment values over repo env file values", async () => {
    await withEnvFile("MOSOO_E2E_PROVIDER=openai\n", (path) => {
      const env = {
        MOSOO_ENV_FILE: path,
        MOSOO_E2E_PROVIDER: "anthropic",
        NO_PROXY: "custom.local",
      };

      loadRepoEnv({ env });

      expect(env.MOSOO_E2E_PROVIDER).toBe("anthropic");
      expect(env.NO_PROXY).toBe("custom.local");
    });
  });

  test("sets local proxy bypass defaults", async () => {
    await withEnvFile("MOSOO_E2E_PROVIDER=openai\n", (path) => {
      const env: NodeJS.ProcessEnv = {
        MOSOO_ENV_FILE: path,
      };

      loadRepoEnv({ env });

      expect(env["NO_PROXY"]).toBe("localhost,127.0.0.1,::1");
      expect(env["no_proxy"]).toBe("localhost,127.0.0.1,::1");
    });
  });

  test("rejects invalid E2E env file lines", async () => {
    await withEnvFile("not valid\n", (path) => {
      expect(() =>
        loadRepoEnv({
          env: {
            MOSOO_ENV_FILE: path,
          },
        }),
      ).toThrow(`Invalid E2E env line 1 in ${path}.`);
    });
  });
});

describe("Preview live harness environment preflight", () => {
  test("accepts the default OpenAI Preview smoke credential inputs", () => {
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: undefined,
          MOSOO_E2E_PROVIDER_API_KEY: undefined,
        },
        () => requireProviderRuntimeEnv("Preview live smoke"),
      ),
    ).toThrow(
      "Preview live smoke requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_OPENAI_API_KEY for MOSOO_E2E_PROVIDER=openai.",
    );
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: undefined,
          MOSOO_E2E_PROVIDER_API_KEY: "placeholder",
        },
        () => requireProviderRuntimeEnv("Preview live smoke"),
      ),
    ).not.toThrow();
  });

  test("accepts Anthropic Preview smoke credential inputs", () => {
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: "anthropic",
          MOSOO_E2E_PROVIDER_API_KEY: undefined,
        },
        () => requireProviderRuntimeEnv("Preview live smoke"),
      ),
    ).toThrow(
      "Preview live smoke requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_ANTHROPIC_API_KEY for MOSOO_E2E_PROVIDER=anthropic.",
    );
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: "placeholder",
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: "anthropic",
          MOSOO_E2E_PROVIDER_API_KEY: undefined,
        },
        () => requireProviderRuntimeEnv("Preview live smoke"),
      ),
    ).not.toThrow();
  });

  test("rejects unsupported Preview smoke providers", () => {
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: "other",
          MOSOO_E2E_PROVIDER_API_KEY: undefined,
        },
        () => requireProviderRuntimeEnv("Preview live smoke"),
      ),
    ).toThrow("MOSOO_E2E_PROVIDER=other is unsupported");
  });

  test("accepts the default OpenAI latency credential inputs", () => {
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: undefined,
          MOSOO_E2E_PROVIDER_API_KEY: undefined,
        },
        () => requireProviderRuntimeEnv("Preview latency"),
      ),
    ).toThrow(
      "Preview latency requires MOSOO_E2E_PROVIDER_API_KEY or MOSOO_E2E_OPENAI_API_KEY for MOSOO_E2E_PROVIDER=openai.",
    );
  });

  test("reads the default OpenAI runtime credential", () => {
    const credential = withPreviewEnv(
      {
        MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
        MOSOO_E2E_OPENAI_API_KEY: "openai-key",
        MOSOO_E2E_PROVIDER: undefined,
        MOSOO_E2E_PROVIDER_API_KEY: undefined,
      },
      () => requirePreviewRuntimeCredential(),
    );

    expect(credential).toEqual({
      apiKey: "openai-key",
      providerId: "openai",
      runtimeButtonName: "OpenAI",
    });
  });

  test("prefers the generic provider key for the selected provider", () => {
    const credential = withPreviewEnv(
      {
        MOSOO_E2E_ANTHROPIC_API_KEY: "anthropic-key",
        MOSOO_E2E_OPENAI_API_KEY: undefined,
        MOSOO_E2E_PROVIDER: "anthropic",
        MOSOO_E2E_PROVIDER_API_KEY: "provider-key",
      },
      () => requirePreviewRuntimeCredential(),
    );

    expect(credential).toEqual({
      apiKey: "provider-key",
      providerId: "anthropic",
      runtimeButtonName: "Claude",
    });
  });
});
