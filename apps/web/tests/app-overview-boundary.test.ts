import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Harness marketplace Workspace home", () => {
  test("starts a Harness Run directly from one Workspace key", () => {
    const route = readSource("../src/routes/app-overview/app-overview.route.tsx");

    expect(route).toContain("listHarnessCatalog");
    expect(route).toContain("createWorkspaceApiKey");
    expect(route).toContain("createWorkspaceRun");
    expect(route).toContain("state.selectedHarness");
    expect(route).toContain("state.task.trim()");
    expect(route).toContain("state.environment.trim()");
    expect(route).toContain('to="/api-keys"');
    expect(route).toContain("runMutation.data.threadId");
    expect(route).not.toContain("agentId");
    expect(route).not.toContain("Deployment");
    expect(route).not.toContain("Channel");
  });

  test("offers the curated Claude Code, Codex, and OpenCode catalog responsively", () => {
    const route = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const catalog = readSource("../../../pkgs/runtime-catalog/src/harness-catalog.ts");

    expect(catalog).toContain('slug: "claude-code"');
    expect(catalog).toContain('slug: "openai-codex"');
    expect(catalog).toContain('slug: "opencode"');
    expect(route).toContain("HARNESSES.map");
    expect(route).toContain("sm:text-5xl");
    expect(route).toContain("lg:grid-cols-");
    expect(route).toContain("lg:sticky");
  });

  test("keeps retired product chains absent from active Web source", () => {
    for (const path of [
      "../src/domains/agent/api/agent-channel-documents.ts",
      "../src/domains/app/api/app-deployment-client.ts",
      "../src/routes/app-overview/deploy/deploy-surface.tsx",
      "../src/routes/agent/components/channels-config-dialog.tsx",
    ]) {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    }
  });

  test("keeps locale copy translated", () => {
    const route = readSource("../src/routes/app-overview/app-overview.route.tsx");
    const en = readSource("../src/shared/i18n/translations/en.json");
    const zhCN = readSource("../src/shared/i18n/translations/zh-CN.json");
    const cjk = /[一-鿿]/u;

    expect(cjk.test(route)).toBe(false);
    expect(cjk.test(en)).toBe(false);
    expect(cjk.test(zhCN)).toBe(true);
  });
});
