// Regenerates the HELP_DOCS index in apps/web/src/shared/config/help-docs.ts from
// the public documentation manifest at https://docs.mosoo.ai/llms.txt.
//
// Usage:
//   just help-docs-index
//
// The script fetches the manifest, derives a section + canonical page URL for each
// entry, and rewrites the region between the GENERATED markers in help-docs.ts.
// Run the project formatter afterwards (`bun run fmt`) so the output matches style.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MANIFEST_URL = "https://docs.mosoo.ai/llms.txt";
const TARGET_PATH = fileURLToPath(
  new URL("../../apps/web/src/shared/config/help-docs.ts", import.meta.url),
);
const BEGIN_MARKER = "// <generated:help-docs>";
const END_MARKER = "// </generated:help-docs>";

const SECTION_ORDER = ["Getting started", "CLI", "API reference"] as const;
type Section = (typeof SECTION_ORDER)[number];

// Lower number sorts first within "Getting started"; everything else keeps
// manifest order.
const GETTING_STARTED_PRIORITY: Record<string, number> = {
  "": 0,
  quickstart: 1,
  "auth-and-access": 2,
};

interface HelpDocEntry {
  manifestIndex: number;
  section: Section;
  title: string;
  url: string;
}

function classifySection(pathname: string): Section {
  if (pathname.startsWith("api-reference/")) {
    return "API reference";
  }
  if (pathname.startsWith("cli/")) {
    return "CLI";
  }
  return "Getting started";
}

function toPageUrl(rawUrl: string): { pathname: string; url: string } {
  const parsed = new URL(rawUrl);
  let pathname = parsed.pathname.replace(/^\/+/, "").replace(/\.md$/, "");
  if (pathname === "index") {
    pathname = "";
  }
  return { pathname, url: `${parsed.origin}/${pathname}` };
}

function parseManifest(text: string): HelpDocEntry[] {
  // The manifest is a markdown link list: "- [Title](url): optional description".
  // We index the rendered help pages only, so non-".md" links (e.g. OpenAPI JSON
  // specs) are skipped.
  const linePattern = /^\s*-\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;
  const entries: HelpDocEntry[] = [];

  for (const line of text.split("\n")) {
    const match = linePattern.exec(line);
    if (match === null) {
      continue;
    }

    const rawUrl = match[2].trim();
    if (!rawUrl.endsWith(".md")) {
      continue;
    }

    const title = match[1].trim();
    const { pathname, url } = toPageUrl(rawUrl);
    entries.push({ manifestIndex: entries.length, section: classifySection(pathname), title, url });
  }

  return entries;
}

function sortEntries(entries: HelpDocEntry[]): HelpDocEntry[] {
  return entries.toSorted((a, b) => {
    const sectionDelta = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    if (sectionDelta !== 0) {
      return sectionDelta;
    }

    if (a.section === "Getting started") {
      const aKey = a.url.replace(/^https?:\/\/[^/]+\//, "");
      const bKey = b.url.replace(/^https?:\/\/[^/]+\//, "");
      const aPriority = GETTING_STARTED_PRIORITY[aKey] ?? Number.MAX_SAFE_INTEGER;
      const bPriority = GETTING_STARTED_PRIORITY[bKey] ?? Number.MAX_SAFE_INTEGER;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
    }

    return a.manifestIndex - b.manifestIndex;
  });
}

function renderEntries(entries: HelpDocEntry[]): string {
  return entries
    .map((entry) => {
      const fields = [
        `section: ${JSON.stringify(entry.section)}`,
        `title: ${JSON.stringify(entry.title)}`,
        `url: ${JSON.stringify(entry.url)}`,
      ].join(", ");
      return `  { ${fields} },`;
    })
    .join("\n");
}

async function main(): Promise<void> {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${MANIFEST_URL}: ${response.status} ${response.statusText}`);
  }

  const manifest = await response.text();
  const entries = sortEntries(parseManifest(manifest));
  if (entries.length === 0) {
    throw new Error("Manifest produced no entries; aborting to avoid emptying the index.");
  }

  const source = await readFile(TARGET_PATH, "utf8");
  const beginIndex = source.indexOf(BEGIN_MARKER);
  const endIndex = source.indexOf(END_MARKER);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(`Could not locate generated markers in ${TARGET_PATH}`);
  }

  const before = source.slice(0, beginIndex + BEGIN_MARKER.length);
  const after = source.slice(endIndex);
  const next = `${before} -- do not edit by hand; see header comment.\n${renderEntries(entries)}\n  ${after}`;

  await writeFile(TARGET_PATH, next, "utf8");
  process.stdout.write(`Wrote ${entries.length} help docs to ${TARGET_PATH}\n`);
  process.stdout.write("Run `bun run fmt` to format the output.\n");
}

await main();
