import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkDriverSubmoduleCheckout,
  validateDriverSubmoduleCheckout,
} from "./check-driver-submodule-state";

describe("driver submodule checkout guard", () => {
  test("accepts the commit recorded by the repository index", () => {
    expect(() =>
      validateDriverSubmoduleCheckout({
        actualCommit: "expected-commit",
        expectedCommit: "expected-commit",
      }),
    ).not.toThrow();
  });

  test("rejects a stale driver checkout with an actionable command", () => {
    expect(() =>
      validateDriverSubmoduleCheckout({
        actualCommit: "stale-commit",
        expectedCommit: "expected-commit",
      }),
    ).toThrow(
      [
        "apps/driver is checked out at the wrong commit.",
        "Expected: expected-commit",
        "Actual:   stale-commit",
        "Run: git submodule update --init --checkout apps/driver",
      ].join("\n"),
    );
  });

  test("reports missing git metadata without masking the failure", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "mosoo-driver-submodule-check-"));

    try {
      expect(() => checkDriverSubmoduleCheckout(repoRoot)).toThrow(
        "apps/driver is not recorded as an initialized gitlink in the repository index.",
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
