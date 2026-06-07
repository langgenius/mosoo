// Index of the Mosoo help documentation hosted at https://docs.mosoo.ai.
//
// The `HELP_DOCS` array below is generated from the site's public documentation
// manifest (https://docs.mosoo.ai/llms.txt). To refresh it after the docs change,
// run:
//
//   bun dev/scripts/generate-help-docs-index.ts
//
// The script rewrites the region between the GENERATED markers in place; keep the
// markers intact and avoid hand-editing entries inside them.

export const HELP_DOCS_BASE_URL = "https://docs.mosoo.ai";

/** Public manifest listing every help page, consumed by the generator script. */
export const HELP_DOCS_MANIFEST_URL = `${HELP_DOCS_BASE_URL}/llms.txt`;

/** Documentation home, used as the "Browse all docs" entry point. */
export const HELP_DOCS_HOME_URL = `${HELP_DOCS_BASE_URL}/`;

export interface HelpDoc {
  /** Section the page belongs to, e.g. "Getting started". */
  section: string;
  /** Human-readable page title. */
  title: string;
  /** Canonical https URL of the rendered page. */
  url: string;
}

export const HELP_DOCS: readonly HelpDoc[] = [
  // <generated:help-docs> -- do not edit by hand; see header comment.
  { section: "Getting started", title: "Mosoo API", url: "https://docs.mosoo.ai/" },
  { section: "Getting started", title: "Quickstart", url: "https://docs.mosoo.ai/quickstart" },
  {
    section: "Getting started",
    title: "Authentication and access",
    url: "https://docs.mosoo.ai/auth-and-access",
  },
  { section: "CLI", title: "CLI", url: "https://docs.mosoo.ai/cli/overview" },
  {
    section: "API reference",
    title: "Add a Thread file",
    url: "https://docs.mosoo.ai/api-reference/add-a-thread-file",
  },
  {
    section: "API reference",
    title: "Archive a Thread",
    url: "https://docs.mosoo.ai/api-reference/archive-a-thread",
  },
  {
    section: "API reference",
    title: "Create a Thread for a published Agent",
    url: "https://docs.mosoo.ai/api-reference/create-a-thread-for-a-published-agent",
  },
  {
    section: "API reference",
    title: "Delete a Thread",
    url: "https://docs.mosoo.ai/api-reference/delete-a-thread",
  },
  {
    section: "API reference",
    title: "List Thread events",
    url: "https://docs.mosoo.ai/api-reference/list-thread-events",
  },
  {
    section: "API reference",
    title: "List Thread files",
    url: "https://docs.mosoo.ai/api-reference/list-thread-files",
  },
  {
    section: "API reference",
    title: "List Threads for a published Agent",
    url: "https://docs.mosoo.ai/api-reference/list-threads-for-a-published-agent",
  },
  {
    section: "API reference",
    title: "Remove a Thread file",
    url: "https://docs.mosoo.ai/api-reference/remove-a-thread-file",
  },
  {
    section: "API reference",
    title: "Retrieve Thread summary",
    url: "https://docs.mosoo.ai/api-reference/retrieve-thread-summary",
  },
  {
    section: "API reference",
    title: "Send user messages, permission decisions, or interrupts to a Thread",
    url: "https://docs.mosoo.ai/api-reference/send-user-messages-permission-decisions-or-interrupts-to-a-thread",
  },
  {
    section: "API reference",
    title: "Stream Thread events",
    url: "https://docs.mosoo.ai/api-reference/stream-thread-events",
  },
  {
    section: "API reference",
    title: "Unarchive a Thread",
    url: "https://docs.mosoo.ai/api-reference/unarchive-a-thread",
  },
  // </generated:help-docs>
];

/**
 * Filter the help index by a free-text query. Matching is case-insensitive over
 * the title and section. Results are ranked so that title prefix matches come
 * first, then other title matches, then section matches; the original index
 * order breaks ties. An empty query returns every doc in index order.
 */
export function searchHelpDocs(query: string, docs: readonly HelpDoc[] = HELP_DOCS): HelpDoc[] {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return [...docs];
  }

  const ranked: { doc: HelpDoc; index: number; score: number }[] = [];

  docs.forEach((doc, index) => {
    const title = doc.title.toLowerCase();
    const section = doc.section.toLowerCase();

    let score = 0;
    if (title.startsWith(needle)) {
      score = 3;
    } else if (title.includes(needle)) {
      score = 2;
    } else if (section.includes(needle)) {
      score = 1;
    }

    if (score > 0) {
      ranked.push({ doc, index, score });
    }
  });

  ranked.sort((a, b) => b.score - a.score || a.index - b.index);

  return ranked.map((entry) => entry.doc);
}
