import { describe, expect, test } from "bun:test";

import { normalizeEnvironmentConfigInput } from "../src/modules/environments/application/environment-config";

function normalizeLimitedHosts(allowedHosts: string[]): string[] {
  return normalizeEnvironmentConfigInput({
    allowMcpServers: false,
    allowPackageManagers: false,
    allowedHosts,
    networkPolicy: "limited",
    packages: [],
    setupScript: "",
  }).allowedHosts;
}

describe("environment network configuration", () => {
  test("accepts canonical domains and rejects IP literals or invalid DNS labels", () => {
    expect(normalizeLimitedHosts([" API.Example.com ", "mcp.linear.app"])).toEqual([
      "api.example.com",
      "mcp.linear.app",
    ]);

    for (const host of [
      "127.0.0.1",
      "[::1]",
      "-api.example.com",
      "api-.example.com",
      "api..example.com",
      "example.com:443",
      "*.example.com",
    ]) {
      expect(() => normalizeLimitedHosts([host])).toThrow(
        "Allowed hosts must be domains without protocol or port.",
      );
    }
  });
});
