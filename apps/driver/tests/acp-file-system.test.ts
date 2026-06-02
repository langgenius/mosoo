import { describe, expect, test } from "bun:test";

import { AcpFileSystem } from "../src/runtimes/acp/acp-file-system";

function createFileSystem(): AcpFileSystem {
  return new AcpFileSystem({
    allowedRoots: [],
    cwd: process.cwd(),
    push: async () => undefined,
  });
}

describe("ACP file system bridge", () => {
  test("rejects non-absolute paths", async () => {
    const fileSystem = createFileSystem();

    await expect(fileSystem.readTextFile({ path: "relative.txt" })).rejects.toThrow(
      "must be absolute",
    );
  });

  test("rejects absolute paths outside the allowed roots", async () => {
    const fileSystem = createFileSystem();

    await expect(fileSystem.readTextFile({ path: "/tmp/outside.txt" })).rejects.toThrow(
      "outside the allowed roots",
    );
  });
});
