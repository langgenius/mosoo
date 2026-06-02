import { describe, expect, test } from "bun:test";

import {
  SANDBOX_CACHE_PATH,
  SANDBOX_MEMORY_PATH,
  getGlobalSpaceMountPath,
  getSessionStateRootPath,
  getSessionWorkspacePath,
  isSandboxSessionStatePath,
  normalizeSandboxFileBrowserPath,
  readRuntimeSpaceMountPathOriginal,
} from "@mosoo/driver-protocol";

describe("runtime sandbox paths", () => {
  test("owns sandbox file browser path admission", () => {
    const globalSpaceMountPath = getGlobalSpaceMountPath("space-1");
    const sessionWorkspacePath = getSessionWorkspacePath("session-1");

    expect(normalizeSandboxFileBrowserPath("", "tree")).toBe("/");
    expect(normalizeSandboxFileBrowserPath(SANDBOX_MEMORY_PATH, "tree")).toBe(SANDBOX_MEMORY_PATH);
    expect(normalizeSandboxFileBrowserPath(`${SANDBOX_MEMORY_PATH}/notes.txt`, "content")).toBe(
      `${SANDBOX_MEMORY_PATH}/notes.txt`,
    );
    expect(normalizeSandboxFileBrowserPath(sessionWorkspacePath, "tree")).toBe(
      sessionWorkspacePath,
    );
    expect(normalizeSandboxFileBrowserPath(globalSpaceMountPath, "tree")).toBe(
      globalSpaceMountPath,
    );
    expect(isSandboxSessionStatePath(getSessionStateRootPath("session-1"))).toBe(true);
    expect(isSandboxSessionStatePath(SANDBOX_MEMORY_PATH)).toBe(false);

    for (const path of [
      "workspace/notes.txt",
      `${SANDBOX_MEMORY_PATH}/`,
      `${SANDBOX_MEMORY_PATH}//notes.txt`,
      `${SANDBOX_MEMORY_PATH}/./notes.txt`,
      `${SANDBOX_MEMORY_PATH}/../cache`,
      String.raw`${SANDBOX_MEMORY_PATH}\notes.txt`,
      `${SANDBOX_MEMORY_PATH}/notes\u0000.txt`,
      SANDBOX_CACHE_PATH,
      getSessionStateRootPath("session-1"),
      `${getSessionStateRootPath("session-1")}/runtime-state.json`,
      `${globalSpaceMountPath}/docs.txt`,
    ] as const) {
      expect(() => normalizeSandboxFileBrowserPath(path, "content")).toThrow();
    }
  });

  test("owns runtime Space mount path admission", () => {
    const globalSpaceMountPath = getGlobalSpaceMountPath("space-1");

    expect(readRuntimeSpaceMountPathOriginal(globalSpaceMountPath)).toBe(globalSpaceMountPath);

    for (const path of [
      "organization/sp/space-1",
      "/",
      `${globalSpaceMountPath}/`,
      `${globalSpaceMountPath}//child`,
      `${globalSpaceMountPath}/./child`,
      `${globalSpaceMountPath}/../child`,
      String.raw`${globalSpaceMountPath}\child`,
      `${globalSpaceMountPath}/space\u0000.txt`,
    ] as const) {
      expect(() => readRuntimeSpaceMountPathOriginal(path)).toThrow();
    }
  });
});
