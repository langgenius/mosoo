import { describe, expect, test } from "bun:test";

import {
  boundAgentUrl,
  mintAppAgentCapabilityToken,
  verifyAppAgentCapabilityToken,
} from "../src/modules/public-api/app-agent-capability";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";

const SECRET = "test-capability-secret";
const NOW = 1_000_000;

function claims(overrides: Partial<AppAgentCapabilityClaims> = {}): AppAgentCapabilityClaims {
  return {
    agentId: "agt_3kf",
    appId: "app_roadmap",
    exp: NOW + 60_000,
    expose: "public_thread",
    ...overrides,
  };
}

describe("app agent capability token", () => {
  test("round-trips mint and verify", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims());
    expect(await verifyAppAgentCapabilityToken(SECRET, token, NOW)).toEqual(claims());
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims());
    expect(await verifyAppAgentCapabilityToken("other-secret", token, NOW)).toBeNull();
  });

  test("rejects a tampered payload", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims());
    const tampered = `${token.split(".")[0]}x.${token.split(".")[1]}`;
    expect(await verifyAppAgentCapabilityToken(SECRET, tampered, NOW)).toBeNull();
  });

  test("rejects an expired token", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims({ exp: NOW }));
    expect(await verifyAppAgentCapabilityToken(SECRET, token, NOW)).toBeNull();
  });

  test("rejects a malformed token", async () => {
    expect(await verifyAppAgentCapabilityToken(SECRET, "not-a-token", NOW)).toBeNull();
    expect(await verifyAppAgentCapabilityToken(SECRET, "", NOW)).toBeNull();
  });

  test("builds a bound-agent url whose embedded token verifies", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims());
    const url = boundAgentUrl("https://api.mosoo.ai/", token);
    expect(url).toBe(`https://api.mosoo.ai/api/v1/bound/${token}`);
    const embedded = url.slice(url.lastIndexOf("/") + 1);
    expect(await verifyAppAgentCapabilityToken(SECRET, embedded, NOW)).toEqual(claims());
  });
});
