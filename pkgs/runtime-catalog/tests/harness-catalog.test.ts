import { describe, expect, test } from "bun:test";

import { getHarnessCatalogEntry, listHarnessCatalog } from "../src";

describe("Harness Catalog", () => {
  test("maps the two launch harnesses to distinct existing runtimes", () => {
    expect(getHarnessCatalogEntry("claude-code")).toMatchObject({
      runtimeId: "claude-agent-sdk",
      slug: "claude-code",
      status: "available",
    });
    expect(getHarnessCatalogEntry("openai-codex")).toMatchObject({
      runtimeId: "openai-runtime",
      slug: "openai-codex",
      status: "available",
    });
  });

  test("gives every curated harness a frozen version and one-line quickstart", () => {
    for (const harness of listHarnessCatalog()) {
      expect(harness.version).toBe("2026.08-experiment.1");
      expect(harness.quickstart).toContain(`harness: "${harness.slug}"`);
      expect(harness.environment.repositoryRequired).toBeFalse();
    }
  });
});
