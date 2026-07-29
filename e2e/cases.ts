export type E2ELayer = "contract" | "deterministic" | "public-api" | "ui";

export interface E2ECommand {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export interface E2ECase {
  readonly command: E2ECommand;
  readonly description: string;
  readonly id: readonly string[];
  readonly layer: E2ELayer;
  readonly requiresEnv?: readonly string[];
  readonly setup?: readonly E2ECommand[];
}

const PLAYWRIGHT = "e2e/node_modules/.bin/playwright";
const VP = "node_modules/.bin/vp";

function playwrightSpec(spec: string): E2ECommand {
  return {
    args: ["test", "--config", "e2e/playwright.config.ts", spec],
    command: PLAYWRIGHT,
  };
}

function bunTest(args: readonly string[]): E2ECommand {
  return {
    args: ["exec", "bun", "test", ...args],
    command: VP,
  };
}

export const e2eCases: readonly E2ECase[] = [
  {
    command: bunTest(["e2e/cases/contract/harness.test.ts"]),
    description: "Verify local E2E harness helpers and environment preflight contracts.",
    id: ["contract", "harness"],
    layer: "contract",
  },
  {
    command: bunTest(["e2e/cases/contract/harness.test.ts"]),
    description: "Verify runtime signal collection and progress reporting contracts.",
    id: ["contract", "signals"],
    layer: "contract",
  },
  {
    command: bunTest([
      "e2e/cases/contract/cold-start-benchmark.test.ts",
      "e2e/cases/contract/cold-start-experiment.test.ts",
      "e2e/cases/contract/cold-start-provenance.test.ts",
      "e2e/cases/contract/frozen-perf-harness.test.ts",
      "e2e/cases/contract/perf-stage-control.test.ts",
    ]),
    description: "Verify balanced cold-start A/B scheduling and statistical retention gates.",
    id: ["contract", "cold-start-benchmark"],
    layer: "contract",
  },
  {
    command: bunTest(["e2e/cases/contract/runtime-e2e-scoreboard.test.ts"]),
    description: "Verify correlated runtime evidence aggregation and qualification gates.",
    id: ["contract", "runtime-scoreboard"],
    layer: "contract",
  },
  {
    command: {
      ...playwrightSpec("e2e/cases/deterministic/session-log.spec.ts"),
      env: {
        MOSOO_E2E_WEB_SERVER_COMMAND: "node_modules/.bin/vp run --filter @mosoo/web dev",
      },
    },
    description: "Replay the deterministic session-log UI path without live provider keys.",
    id: ["deterministic", "session-log"],
    layer: "deterministic",
    setup: [bunTest(["e2e/cases/contract/harness.test.ts"])],
  },
  {
    command: {
      ...playwrightSpec("e2e/cases/ui/files-page.spec.ts"),
      env: {
        MOSOO_E2E_WEB_SERVER_COMMAND: "node_modules/.bin/vp run --filter @mosoo/web dev",
      },
    },
    description: "Verify the Files page deterministic scope filters.",
    id: ["ui", "files-page"],
    layer: "ui",
  },
  {
    command: playwrightSpec("e2e/cases/ui/preview.spec.ts"),
    description: "Run the live Preview browser journey.",
    id: ["ui", "preview"],
    layer: "ui",
    requiresEnv: [
      "MOSOO_E2E_PROVIDER_API_KEY|MOSOO_E2E_OPENAI_API_KEY|MOSOO_E2E_ANTHROPIC_API_KEY",
    ],
  },
  {
    command: playwrightSpec("e2e/cases/public-api/runtime.spec.ts"),
    description: "Trigger a real runtime run through the Public API and observe events.",
    id: ["public-api", "runtime"],
    layer: "public-api",
    requiresEnv: [
      "MOSOO_E2E_PROVIDER_API_KEY|MOSOO_E2E_OPENAI_API_KEY|MOSOO_E2E_ANTHROPIC_API_KEY|MOSOO_E2E_OPENCODE_API_KEY|MOSOO_E2E_DEEPSEEK_API_KEY",
    ],
  },
  {
    command: playwrightSpec("e2e/cases/public-api/latency.spec.ts"),
    description: "Measure live Preview and Public API runtime latency.",
    id: ["public-api", "latency"],
    layer: "public-api",
    requiresEnv: [
      "MOSOO_E2E_PROVIDER_API_KEY|MOSOO_E2E_OPENAI_API_KEY|MOSOO_E2E_ANTHROPIC_API_KEY",
    ],
  },
  {
    command: {
      ...playwrightSpec("e2e/cases/public-api/runtime-scoreboard.spec.ts"),
      env: {
        MOSOO_E2E_WEB_SERVER_COMMAND: "node_modules/.bin/vp run --filter @mosoo/web dev",
      },
    },
    description: "Capture correlated DeepSeek provider-to-browser runtime scoreboard samples.",
    id: ["public-api", "runtime-scoreboard"],
    layer: "public-api",
    requiresEnv: [
      "API_PROXY_TARGET",
      "MOSOO_E2E_EMAIL",
      "MOSOO_E2E_PERF_AUTH_TOKEN",
      "MOSOO_E2E_RUNTIME_BROWSER_OUTPUT",
      "MOSOO_E2E_RUNTIME_FIXTURE_INPUT",
    ],
  },
  {
    command: {
      args: ["exec", "bun", "e2e/bin/cold-start-ab.ts"],
      command: VP,
    },
    description: "Run dual-stack, four-rollout crossover cold-start A/B samples.",
    id: ["public-api", "cold-start-ab"],
    layer: "public-api",
    requiresEnv: [
      "CLOUDFLARE_ACCOUNT_ID",
      "MOSOO_PERF_AFTER_ROOT",
      "MOSOO_PERF_AFTER_CONTAINER_DISK_MB",
      "MOSOO_PERF_AFTER_CONTAINER_INSTANCE_TYPE",
      "MOSOO_PERF_AFTER_CONTAINER_MAX_INSTANCES",
      "MOSOO_PERF_AFTER_CONTAINER_MEMORY_MIB",
      "MOSOO_PERF_AFTER_CONTAINER_VCPU",
      "MOSOO_PERF_A_BASE_URL",
      "MOSOO_PERF_A_CF_ENV",
      "MOSOO_PERF_A_CONTAINER_APPLICATION_NAME",
      "MOSOO_PERF_A_D1_DATABASE_ID",
      "MOSOO_PERF_A_RESOURCE_PREFIX",
      "MOSOO_PERF_A_WORKER_NAME",
      "MOSOO_PERF_A_WRANGLER_TEMPLATE",
      "MOSOO_PERF_AUTH_TOKEN",
      "MOSOO_PERF_B_BASE_URL",
      "MOSOO_PERF_B_CF_ENV",
      "MOSOO_PERF_B_CONTAINER_APPLICATION_NAME",
      "MOSOO_PERF_B_D1_DATABASE_ID",
      "MOSOO_PERF_B_RESOURCE_PREFIX",
      "MOSOO_PERF_B_WORKER_NAME",
      "MOSOO_PERF_B_WRANGLER_TEMPLATE",
      "MOSOO_PERF_BEFORE_ROOT",
      "MOSOO_PERF_BEFORE_CONTAINER_DISK_MB",
      "MOSOO_PERF_BEFORE_CONTAINER_INSTANCE_TYPE",
      "MOSOO_PERF_BEFORE_CONTAINER_MAX_INSTANCES",
      "MOSOO_PERF_BEFORE_CONTAINER_MEMORY_MIB",
      "MOSOO_PERF_BEFORE_CONTAINER_VCPU",
      "MOSOO_PERF_FIXTURE_A",
      "MOSOO_PERF_FIXTURE_B",
      "MOSOO_PERF_HOOK",
      "MOSOO_PERF_OUTPUT",
    ],
  },
];
