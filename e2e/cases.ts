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
];
