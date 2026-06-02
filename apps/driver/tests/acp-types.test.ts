import { describe, expect, test } from "bun:test";

import {
  parseAcpInitializeResult,
  parseAcpPromptResult,
  parseAcpSessionSetupResult,
} from "../src/runtimes/acp/acp-types";

describe("ACP protocol parsers", () => {
  test("parses supported prompt stop reasons", () => {
    for (const stopReason of [
      "cancelled",
      "end_turn",
      "max_tokens",
      "max_turn_requests",
      "refusal",
    ] as const) {
      expect(parseAcpPromptResult({ stopReason })).toMatchObject({ stopReason });
    }
  });

  test("rejects malformed prompt results", () => {
    expect(() => parseAcpPromptResult(null)).toThrow();
    expect(() => parseAcpPromptResult({})).toThrow();
    expect(() => parseAcpPromptResult({ stopReason: "unknown" })).toThrow();
  });

  test("rejects malformed boundary results", () => {
    expect(() => parseAcpInitializeResult(null)).toThrow();
    expect(() => parseAcpSessionSetupResult(null)).toThrow();
  });
});
