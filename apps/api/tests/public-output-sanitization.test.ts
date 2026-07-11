import { describe, expect, test } from "bun:test";

import { sanitizePublicOutput } from "../src/modules/public-api/public-output-sanitization";

const PRIVATE_CITATION = "\uE200cite\uE202turn2view0\uE202turn8view0\uE201";

describe("public output sanitization", () => {
  test("removes provider-private citation markup and reports a warning", () => {
    expect(sanitizePublicOutput(`before${PRIVATE_CITATION}after`)).toEqual({
      text: "beforeafter",
      warnings: [
        {
          code: "unresolved_provider_citation",
          count: 1,
        },
      ],
    });
  });

  test("preserves text that contains no complete private citation envelope", () => {
    expect(sanitizePublicOutput("before\uE200other\uE201after")).toEqual({
      text: "before\uE200other\uE201after",
      warnings: [],
    });
    expect(sanitizePublicOutput("before\uE200cite\uE202turn2view0")).toEqual({
      text: "before\uE200cite\uE202turn2view0",
      warnings: [],
    });
  });
});
