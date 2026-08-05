import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const localeFiles = ["en", "zh-CN", "zh-TW", "ja"] as const;
const localeDir = new URL("../src/shared/i18n/translations/", import.meta.url);

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;

  for (const [key, child] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof child === "string") result.set(path, child);
    else for (const [childKey, text] of flatten(child, path)) result.set(childKey, text);
  }
  return result;
}

function variables(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] ?? "").toSorted();
}

describe("translation catalog parity", () => {
  const catalogs = Object.fromEntries(
    localeFiles.map((locale) => [
      locale,
      flatten(JSON.parse(readFileSync(new URL(`${locale}.json`, localeDir), "utf8"))),
    ]),
  ) as Record<(typeof localeFiles)[number], Map<string, string>>;

  test("every locale has exactly the English keys", () => {
    const expected = [...catalogs.en.keys()].toSorted();
    for (const locale of localeFiles)
      expect([...catalogs[locale].keys()].toSorted()).toEqual(expected);
  });

  test("interpolation variables match English", () => {
    for (const [key, english] of catalogs.en) {
      for (const locale of localeFiles)
        expect(variables(catalogs[locale].get(key) ?? "")).toEqual(variables(english));
    }
  });
});
