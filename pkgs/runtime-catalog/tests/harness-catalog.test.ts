import { describe, expect, test } from "bun:test";

import { getHarnessCatalogEntry, getHarnessProfileVersion, listHarnessCatalog } from "../src";

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

  test("publishes only locked, complete Profile Versions", () => {
    for (const harness of listHarnessCatalog()) {
      expect(harness.profiles).toHaveLength(1);
      expect(harness.defaultProfile).toBe(harness.profiles[0]?.reference);
      expect(harness.profiles[0]).toMatchObject({
        provenance: { revision: expect.any(String), source: expect.any(String) },
        trust: {
          composition: "locked",
          execution: "shell-equivalent",
          isolation: "cattle",
        },
      });
      expect(harness.quickstart).toContain(`harness: "${harness.slug}"`);
      expect(harness.environment.repositoryRequired).toBeFalse();
    }
  });

  test("keeps plugin-rich DeepSeek Harness as one unavailable distribution", () => {
    const harness = getHarnessCatalogEntry("deepseek-harness");

    expect(harness).toMatchObject({
      profiles: [
        {
          id: "deepseek-harness/headless",
          provenance: {
            revision: "141eb6fef83422698aef7a981029e843e8161534",
            source: "https://github.com/deepseek-ai/deepseek-harness",
          },
          version: "0.1.0-rc.8",
        },
      ],
      slug: "deepseek-harness",
      status: "unavailable",
    });
  });

  test("resolves an exact Profile Version and does not fabricate benchmark evidence", () => {
    const codex = getHarnessCatalogEntry("openai-codex");
    const openCode = getHarnessCatalogEntry("opencode");

    expect(codex).not.toBeNull();
    expect(openCode).not.toBeNull();
    expect(getHarnessProfileVersion("openai-codex", codex!.defaultProfile)).toMatchObject({
      benchmark: {
        model: "gpt-5.5",
        result: null,
        status: "contract_smoke",
      },
      id: "openai-codex/mosoo-baseline",
    });
    expect(getHarnessProfileVersion("opencode", openCode!.defaultProfile)).toMatchObject({
      benchmark: {
        model: "gpt-5.5",
        result: null,
        status: "contract_smoke",
      },
      id: "opencode/mosoo-baseline",
    });
    expect(getHarnessProfileVersion("openai-codex", "openai-codex/unknown@1")).toBeNull();
  });
});
