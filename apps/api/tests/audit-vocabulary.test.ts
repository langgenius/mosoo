import { describe, expect, test } from "bun:test";

import {
  AUDIT_OUTCOME,
  AUDIT_OUTCOMES,
  isAuditOutcome,
} from "../src/modules/audit/domain/audit-vocabulary";

describe("audit vocabulary", () => {
  test("keeps outcomes finite and ordered for UI/export filters", () => {
    expect(AUDIT_OUTCOMES).toEqual([
      AUDIT_OUTCOME.denied,
      AUDIT_OUTCOME.failure,
      AUDIT_OUTCOME.success,
    ]);
    expect(isAuditOutcome("denied")).toBe(true);
    expect(isAuditOutcome("partial")).toBe(false);
  });
});
