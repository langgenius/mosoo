import { describe, expect, test } from "bun:test";

import { toContainerReachableOrigin } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-sandbox-provisioning.paths";

describe("toContainerReachableOrigin", () => {
  test("rewrites localhost to host.docker.internal and keeps the port", () => {
    expect(toContainerReachableOrigin("http://localhost:5173/api/graphql")).toBe(
      "http://host.docker.internal:5173/api/graphql",
    );
    expect(toContainerReachableOrigin("http://localhost:8788/api/graphql")).toBe(
      "http://host.docker.internal:8788/api/graphql",
    );
  });

  test("rewrites 127.0.0.1 to host.docker.internal and keeps the port", () => {
    expect(toContainerReachableOrigin("http://127.0.0.1:8787/api/graphql")).toBe(
      "http://host.docker.internal:8787/api/graphql",
    );
  });

  test("keeps a localhost URL without an explicit port on the default port", () => {
    expect(toContainerReachableOrigin("http://localhost/api/graphql")).toBe(
      "http://host.docker.internal/api/graphql",
    );
  });

  test("leaves public origins untouched", () => {
    expect(toContainerReachableOrigin("https://try.mosoo.ai/api/graphql")).toBe(
      "https://try.mosoo.ai/api/graphql",
    );
  });

  test("uses an explicit container origin for tunneled requests", () => {
    expect(
      toContainerReachableOrigin(
        "https://random.trycloudflare.com/api/v1/threads",
        "http://host.docker.internal:8787",
      ),
    ).toBe("http://host.docker.internal:8787/api/v1/threads");
  });
});
