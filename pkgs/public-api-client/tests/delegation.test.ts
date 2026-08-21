import { describe, expect, test } from "bun:test";

import { MosooDelegationVerificationError, verifyDelegation } from "../src/delegation.ts";

const ACCESS_TOKEN = "mcp-upstream-secret";
const AUDIENCE = "https://tools.example.com/mcp";
const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = NOW_MS / 1_000;
const encoder = new TextEncoder();

const baseClaims = {
  act: {
    agent_id: "01J00000000000000000000009",
    app_id: "01J0000000000000000000000Q",
  },
  aud: AUDIENCE,
  exp: NOW_SECONDS + 60,
  iat: NOW_SECONDS,
  iss: "mosoo",
  jti: "00000000-0000-4000-8000-000000000001",
  run_id: "01J0000000000000000000000N",
  sub: "customer-123",
  thread_id: "01J0000000000000000000000B",
};

function toBase64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function createToken(
  claims: Record<string, unknown> = baseClaims,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): Promise<string> {
  const headerSegment = toBase64Url(JSON.stringify(header));
  const payloadSegment = toBase64Url(JSON.stringify(claims));
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`mosoo-mcp-delegation-v1\0${ACCESS_TOKEN}`),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${headerSegment}.${payloadSegment}`),
  );

  return `${headerSegment}.${payloadSegment}.${toBase64Url(new Uint8Array(signature))}`;
}

async function expectCode(
  input: Parameters<typeof verifyDelegation>[0],
  code: MosooDelegationVerificationError["code"],
): Promise<void> {
  try {
    await verifyDelegation(input);
    throw new Error("Expected delegation verification to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(MosooDelegationVerificationError);
    expect(error).toMatchObject({ code });
  }
}

describe("verifyDelegation", () => {
  test("returns a typed application-user execution context", async () => {
    const token = await createToken();

    expect(
      await verifyDelegation({
        accessToken: ACCESS_TOKEN,
        audience: AUDIENCE,
        nowMs: NOW_MS + 30_000,
        token,
      }),
    ).toEqual({
      agentId: baseClaims.act.agent_id,
      appId: baseClaims.act.app_id,
      audience: AUDIENCE,
      expiresAt: new Date((NOW_SECONDS + 60) * 1_000),
      issuedAt: new Date(NOW_MS),
      runId: baseClaims.run_id,
      threadId: baseClaims.thread_id,
      tokenId: baseClaims.jti,
      userId: baseClaims.sub,
    });
  });

  test("rejects missing, malformed, and incorrectly signed tokens", async () => {
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: AUDIENCE, nowMs: NOW_MS, token: null },
      "missing_token",
    );
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: AUDIENCE, nowMs: NOW_MS, token: "not.jwt" },
      "invalid_format",
    );

    const token = await createToken();
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: AUDIENCE, nowMs: NOW_MS, token: forged },
      "invalid_signature",
    );
  });

  test("rejects invalid verifier configuration", async () => {
    const token = await createToken();
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: " ", nowMs: NOW_MS, token },
      "invalid_configuration",
    );
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: AUDIENCE, nowMs: Number.NaN, token },
      "invalid_configuration",
    );
  });

  test("rejects disallowed algorithms before accepting a signature", async () => {
    const token = await createToken(baseClaims, { alg: "none", typ: "JWT" });
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: AUDIENCE, nowMs: NOW_MS, token },
      "invalid_header",
    );
  });

  test.each([
    ["wrong issuer", { ...baseClaims, iss: "attacker" }],
    ["wrong audience", { ...baseClaims, aud: "https://attacker.example/mcp" }],
    ["expired", { ...baseClaims, exp: NOW_SECONDS }],
    ["future issued-at", { ...baseClaims, iat: NOW_SECONDS + 6 }],
    ["excessive lifetime", { ...baseClaims, exp: NOW_SECONDS + 61 }],
    ["empty app id", { ...baseClaims, act: { ...baseClaims.act, app_id: "" } }],
    ["missing token id", { ...baseClaims, jti: undefined }],
  ])("rejects invalid claims: %s", async (_label, claims) => {
    const token = await createToken(claims);
    await expectCode(
      { accessToken: ACCESS_TOKEN, audience: AUDIENCE, nowMs: NOW_MS, token },
      "invalid_claims",
    );
  });
});
