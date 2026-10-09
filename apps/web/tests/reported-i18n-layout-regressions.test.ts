import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import en from "../src/shared/i18n/translations/en.json";
import ja from "../src/shared/i18n/translations/ja.json";
import zhCN from "../src/shared/i18n/translations/zh-CN.json";
import zhTW from "../src/shared/i18n/translations/zh-TW.json";
import { SESSION_EVENT_TYPE_LABEL_KEY } from "../src/shared/ui/session-events/domain";

function lookup(tree: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((current, part) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[part];
  }, tree);
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("reported i18n and dialog layout regressions", () => {
  test("every session event label key resolves in every locale", () => {
    for (const catalog of [en, zhCN, zhTW, ja]) {
      for (const key of Object.values(SESSION_EVENT_TYPE_LABEL_KEY)) {
        const value = lookup(catalog, key);
        expect(typeof value).toBe("string");
        expect(value).not.toBe(key);
      }
    }
  });

  test("keeps add and edit MCP dialog bodies independently scrollable", () => {
    for (const path of [
      "../src/routes/integrations/mcp/add-mcp-dialog.tsx",
      "../src/routes/integrations/mcp/edit-mcp-dialog.tsx",
    ]) {
      const source = readSource(path);
      expect(source).toContain("max-h-[calc(100dvh-2rem)]");
      expect(source).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
      expect(source).toContain("min-h-0 space-y-4 overflow-y-auto");
    }
  });
});
