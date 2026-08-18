import { describe, expect, test } from "bun:test";

import { findLongRunningContainers } from "./check-container-runtime";

describe("container runtime alert", () => {
  test("reports only billable states older than the threshold", () => {
    const now = Date.parse("2026-08-18T12:00:00Z");
    const instances = [
      { created: "2026-08-18T09:00:00Z", id: "old", state: "running" },
      { created: "2026-08-18T11:00:00Z", id: "new", state: "running" },
      { created: "2026-08-01T00:00:00Z", id: "inactive", state: "inactive" },
    ];

    expect(findLongRunningContainers(instances, now, 2).map((instance) => instance.id)).toEqual([
      "old",
    ]);
  });
});
