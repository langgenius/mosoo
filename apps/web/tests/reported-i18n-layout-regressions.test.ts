import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { HELP_DOC_COPY_KEYS } from "../src/features/help/help-doc-copy";
import { HELP_DOCS } from "../src/shared/config/help-docs";
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

  test("passes the active translator to every Thread process event label", () => {
    for (const path of [
      "../src/routes/threads/process-modal/process-event-row.tsx",
      "../src/routes/threads/process-modal/process-timeline-bar.tsx",
    ]) {
      const source = readSource(path);
      expect(source).not.toContain("getSessionEventLabel(event.type)");
      expect(source).toContain("getSessionEventLabel(event.type, t)");
    }
  });

  test("translates every generated help index title at the dialog boundary", () => {
    const source = readSource("../src/features/help/help-docs-dialog.tsx");

    expect(source).toContain("HELP_DOC_COPY_KEYS");
    expect(source).toContain("HELP_SECTION_COPY_KEYS");
    expect(source).toContain("translatedDocTitle(doc, t)");
    expect(source).toContain("translatedSection(doc.section, t)");
    expect(source).not.toContain("t(HELP_DOC_COPY_KEYS[doc.url] ?? doc.title)");
    expect(source).not.toContain("t(HELP_SECTION_COPY_KEYS[doc.section] ?? doc.section)");
    expect(Object.keys(HELP_DOC_COPY_KEYS).toSorted()).toEqual(
      HELP_DOCS.map((doc) => doc.url).toSorted(),
    );
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

  test("does not render contract-owned Agent kind English copy directly", () => {
    const source = readSource("../src/routes/agent/components/kind-selector.tsx");

    expect(source).toContain("CARD_COPY_KEYS");
    expect(source).toContain("COMPARISON_COPY_KEYS");
    expect(source).not.toContain("card.copy.label");
    expect(source).not.toContain("row.values.pet");
    expect(source).not.toContain("row.values.cattle");
  });
});
