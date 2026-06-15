import { describe, expect, test } from "bun:test";

import { HELP_DOCS, HELP_DOCS_BASE_URL, searchHelpDocs } from "../src/shared/config/help-docs";

describe("help docs index", () => {
  test("every entry points at the docs site and has a section + title", () => {
    expect(HELP_DOCS.length).toBeGreaterThan(0);

    for (const doc of HELP_DOCS) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.section.length).toBeGreaterThan(0);
      expect(doc.url.startsWith(HELP_DOCS_BASE_URL)).toBe(true);
    }
  });

  test("urls are unique", () => {
    const urls = HELP_DOCS.map((doc) => doc.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test("urls render html pages, not raw markdown", () => {
    for (const doc of HELP_DOCS) {
      expect(doc.url.endsWith(".md")).toBe(false);
    }
  });

  test("uses Agent API Endpoint titles for Thread API entries", () => {
    expect(HELP_DOCS).toContainEqual(
      expect.objectContaining({
        title: "Create a Thread for an Agent API Endpoint",
        url: "https://docs.mosoo.ai/api-reference/create-a-thread-for-a-published-agent",
      }),
    );
    expect(HELP_DOCS).toContainEqual(
      expect.objectContaining({
        title: "List Threads for an Agent API Endpoint",
        url: "https://docs.mosoo.ai/api-reference/list-threads-for-a-published-agent",
      }),
    );
    expect(HELP_DOCS.map((doc) => doc.title.toLowerCase()).join("\n")).not.toContain(
      "published agent",
    );
  });
});

describe("searchHelpDocs", () => {
  test("an empty query returns the full index in order", () => {
    expect(searchHelpDocs("")).toEqual([...HELP_DOCS]);
    expect(searchHelpDocs("   ")).toEqual([...HELP_DOCS]);
  });

  test("matches titles case-insensitively", () => {
    const results = searchHelpDocs("quickstart");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title.toLowerCase()).toContain("quickstart");
  });

  test("ranks title prefix matches ahead of substring matches", () => {
    const results = searchHelpDocs("archive");
    // "Archive a Thread" (prefix) should rank above "Unarchive a Thread".
    const archiveIndex = results.findIndex((doc) => doc.title === "Archive a Thread");
    const unarchiveIndex = results.findIndex((doc) => doc.title === "Unarchive a Thread");
    expect(archiveIndex).toBeGreaterThanOrEqual(0);
    expect(unarchiveIndex).toBeGreaterThanOrEqual(0);
    expect(archiveIndex).toBeLessThan(unarchiveIndex);
  });

  test("matches by section", () => {
    const results = searchHelpDocs("api reference");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((doc) => doc.section === "API reference")).toBe(true);
  });

  test("returns an empty array when nothing matches", () => {
    expect(searchHelpDocs("zzz-no-such-doc")).toEqual([]);
  });
});
