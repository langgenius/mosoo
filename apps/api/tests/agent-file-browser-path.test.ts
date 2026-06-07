import { describe, expect, test } from "bun:test";

import {
  SANDBOX_CACHE_PATH,
  SANDBOX_GLOBAL_SPACE_ROOT,
  SANDBOX_MEMORY_PATH,
  SANDBOX_SESSION_ROOT,
  getSessionStateRootPath,
} from "agent-driver/paths";

import { normalizeAgentFileBrowserPath } from "../src/modules/runtime/application/agent-file-browser-path";

describe("agent file browser path", () => {
  test("admits explicit sandbox browser paths", () => {
    expect(normalizeAgentFileBrowserPath("", "tree")).toBe("/");
    expect(normalizeAgentFileBrowserPath(SANDBOX_MEMORY_PATH, "tree")).toBe(SANDBOX_MEMORY_PATH);
    expect(normalizeAgentFileBrowserPath(`${SANDBOX_MEMORY_PATH}/notes.txt`, "content")).toBe(
      `${SANDBOX_MEMORY_PATH}/notes.txt`,
    );
    expect(normalizeAgentFileBrowserPath(`${SANDBOX_SESSION_ROOT}/session-1`, "tree")).toBe(
      `${SANDBOX_SESSION_ROOT}/session-1`,
    );
  });

  test("rejects unsafe originals before sandbox path normalization", () => {
    for (const [path, message] of [
      ["workspace/notes.txt", "absolute"],
      [`${SANDBOX_MEMORY_PATH}/`, "end with a separator"],
      [`${SANDBOX_MEMORY_PATH}//notes.txt`, "empty segments"],
      [`${SANDBOX_MEMORY_PATH}/./notes.txt`, "current segments"],
      [`${SANDBOX_MEMORY_PATH}/../cache`, "traversal segments"],
      [String.raw`${SANDBOX_MEMORY_PATH}\notes.txt`, "'/' separators"],
      [`${SANDBOX_MEMORY_PATH}/notes\u0000.txt`, "control characters"],
    ] as const) {
      expect(() => normalizeAgentFileBrowserPath(path, "tree")).toThrow(message);
    }
  });

  test("keeps private cache and Space files outside sandbox browser content", () => {
    expect(() => normalizeAgentFileBrowserPath(SANDBOX_CACHE_PATH, "tree")).toThrow(
      "Sandbox cache is not visible",
    );
    expect(() =>
      normalizeAgentFileBrowserPath(getSessionStateRootPath("session-1"), "tree"),
    ).toThrow("Session runtime state is not visible");
    expect(() =>
      normalizeAgentFileBrowserPath(`${SANDBOX_GLOBAL_SPACE_ROOT}/space-1/docs.txt`, "content"),
    ).toThrow("Space files open in the Space page.");
    expect(normalizeAgentFileBrowserPath(`${SANDBOX_GLOBAL_SPACE_ROOT}/space-1`, "tree")).toBe(
      `${SANDBOX_GLOBAL_SPACE_ROOT}/space-1`,
    );
  });
});
