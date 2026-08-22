import { describe, expect, test } from "bun:test";

import { getTranslationCatalog, loadTranslationCatalog } from "../src/shared/i18n/catalogs";

describe("translation catalog loading", () => {
  test("keeps English available without an asynchronous catalog load", () => {
    expect(getTranslationCatalog("en")["common"]).toBeDefined();
  });

  test("loads a selected non-default catalog on demand", async () => {
    const englishCommon = getTranslationCatalog("en")["common"];

    await loadTranslationCatalog("ja");

    expect(getTranslationCatalog("ja")["common"]).toBeDefined();
    expect(getTranslationCatalog("ja")["common"]).not.toEqual(englishCommon);
  });
});
