import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AgentId, AppDeploymentId, AppDeploymentRunId, AppId } from "@mosoo/id";

import {
  boundAgentUrl,
  mintAppAgentCapabilityToken,
  verifyAppAgentCapabilityToken,
} from "../src/modules/public-api/app-agent-capability";
import type { AppAgentCapabilityClaims } from "../src/modules/public-api/app-agent-capability";

const SECRET = "test-capability-secret";
const NOW = 1_000_000;
const AGENT_ID = parsePlatformId<AgentId>("01J00000000000000000000009");
const APP_ID = parsePlatformId<AppId>("01J0000000000000000000000Q");
const DEPLOYMENT_ID = parsePlatformId<AppDeploymentId>("01J0000000000000000000000D");
const DEPLOYMENT_RUN_ID = parsePlatformId<AppDeploymentRunId>("01J0000000000000000000000R");

function claims(overrides: Partial<AppAgentCapabilityClaims> = {}): AppAgentCapabilityClaims {
  return {
    agentId: AGENT_ID,
    appId: APP_ID,
    binding: { env: "MOSOO_AGENT", expose: "public_thread", name: "Roadmap" },
    deploymentId: DEPLOYMENT_ID,
    deploymentRunId: DEPLOYMENT_RUN_ID,
    exp: NOW + 60_000,
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

  test("rejects a legacy token without deployment authority claims", async () => {
    const legacy = await mintLegacyToken(SECRET, {
      agentId: AGENT_ID,
      appId: APP_ID,
      exp: NOW + 60_000,
      expose: "public_thread",
    });

    expect(await verifyAppAgentCapabilityToken(SECRET, legacy, NOW)).toBeNull();
  });

  test("builds a bound-agent url whose embedded token verifies", async () => {
    const token = await mintAppAgentCapabilityToken(SECRET, claims());
    const url = boundAgentUrl("https://api.mosoo.ai/", token);
    expect(url).toBe(`https://api.mosoo.ai/api/v1/bound/${token}`);
    const embedded = url.slice(url.lastIndexOf("/") + 1);
    expect(await verifyAppAgentCapabilityToken(SECRET, embedded, NOW)).toEqual(claims());
  });
});

async function mintLegacyToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const encoded = btoa(JSON.stringify(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  const signatureEncoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

  return `${encoded}.${signatureEncoded}`;
}
