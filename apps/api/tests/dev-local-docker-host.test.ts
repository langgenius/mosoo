import { describe, expect, test } from "bun:test";

import { resolveMacDockerHost } from "../bin/dev-local-docker-host";

describe("resolveMacDockerHost", () => {
  test("prefers OrbStack and falls back to Docker Desktop", () => {
    const available = new Set([
      "/Users/test/.orbstack/run/docker.sock",
      "/Users/test/.docker/run/docker.sock",
    ]);
    const pathExists = (path: string): boolean => available.has(path);

    expect(resolveMacDockerHost("darwin", "/Users/test", pathExists)).toEqual({
      host: "unix:///Users/test/.orbstack/run/docker.sock",
      name: "OrbStack",
    });

    available.delete("/Users/test/.orbstack/run/docker.sock");

    expect(resolveMacDockerHost("darwin", "/Users/test", pathExists)).toEqual({
      host: "unix:///Users/test/.docker/run/docker.sock",
      name: "Docker Desktop",
    });
  });

  test("keeps the default Docker configuration off macOS or without a known socket", () => {
    expect(resolveMacDockerHost("linux", "/home/test", () => true)).toBeNull();
    expect(resolveMacDockerHost("darwin", "/Users/test", () => false)).toBeNull();
  });
});
