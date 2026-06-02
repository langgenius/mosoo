import { describe, expect, test } from "bun:test";

import {
  SANDBOX_MEMORY_PATH,
  SANDBOX_SESSION_STATE_DIR,
  SANDBOX_SESSION_ROOT,
} from "@mosoo/driver-protocol";

import { parseAgentFileListingOutput } from "../src/modules/runtime/application/agent-file-browser-listing";

function encodeName(name: string): string {
  return btoa(name);
}

describe("agent file browser listing", () => {
  test("removes private session runtime state from sandbox listings", () => {
    const listing = parseAgentFileListingOutput(
      `${SANDBOX_SESSION_ROOT}/session-1`,
      [
        `directory\t0\t${encodeName(SANDBOX_SESSION_STATE_DIR)}`,
        `file\t5\t${encodeName("notes.txt")}`,
      ].join("\n"),
    );

    expect(listing.entries.map((entry) => entry.name)).toEqual(["notes.txt"]);
    expect(listing.totalCount).toBe(1);
  });

  test("keeps same-named user files outside session runtime state roots", () => {
    const listing = parseAgentFileListingOutput(
      SANDBOX_MEMORY_PATH,
      `directory\t0\t${encodeName(SANDBOX_SESSION_STATE_DIR)}`,
    );

    expect(listing.entries.map((entry) => entry.path)).toEqual([
      `${SANDBOX_MEMORY_PATH}/${SANDBOX_SESSION_STATE_DIR}`,
    ]);
  });
});
