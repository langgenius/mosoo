import { describe, expect, test } from "bun:test";

import { redactRequestLogPath } from "../src/adapters/http/request-logging.middleware";

describe("request log path redaction", () => {
  test("hides the bound capability token but keeps the route shape", () => {
    expect(redactRequestLogPath("/api/v1/bound/eyJhbGciOi.signature")).toBe("/api/v1/bound/:token");
    expect(redactRequestLogPath("/api/v1/bound/eyJhbGciOi.signature/threads")).toBe(
      "/api/v1/bound/:token/threads",
    );
    expect(
      redactRequestLogPath(
        "/api/v1/bound/eyJhbGciOi.signature/files/01J0000000000000000000000J/content",
      ),
    ).toBe("/api/v1/bound/:token/files/01J0000000000000000000000J/content");
  });

  test("leaves every other path untouched", () => {
    for (const path of [
      "/api/v1/threads/01J00000000000000000000009",
      "/api/v1/bound",
      "/graphql",
    ]) {
      expect(redactRequestLogPath(path)).toBe(path);
    }
  });
});
