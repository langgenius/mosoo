import { describe, expect, test } from "bun:test";

import { toVibeAppStatusView } from "../src/routes/app-overview/vibe/vibe-app-status";
import type { VibeAppStatusView } from "../src/routes/app-overview/vibe/vibe-app-status";

interface StatusCase {
  input: {
    previewUrl: string | null;
    productionUrl: string | null;
    status: "generating" | "ready";
  };
  name: string;
  expected: VibeAppStatusView;
}

const PREVIEW_URL = "https://preview.vibesdk.test";
const PRODUCTION_URL = "https://live.vibesdk.test";

const cases: StatusCase[] = [];

for (const status of ["generating", "ready"] as const) {
  for (const previewUrl of [null, PREVIEW_URL]) {
    for (const productionUrl of [null, PRODUCTION_URL]) {
      cases.push({
        expected: {
          badgeLabel: status === "ready" ? "Ready" : "Building",
          badgeTone: status === "ready" ? "success" : "progress",
          canPublish: status === "ready",
          previewState: previewUrl !== null ? "live" : "pending",
          productionState: productionUrl !== null ? "live" : "unpublished",
        },
        input: { previewUrl, productionUrl, status },
        name: `${status} preview=${previewUrl !== null} production=${productionUrl !== null}`,
      });
    }
  }
}

describe("vibe app status projection", () => {
  for (const statusCase of cases) {
    test(statusCase.name, () => {
      expect(toVibeAppStatusView(statusCase.input)).toEqual(statusCase.expected);
    });
  }

  test("covers the full status matrix", () => {
    expect(cases).toHaveLength(8);
  });
});
