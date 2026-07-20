import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildDevVars, validateWebExposure } from "../docker/runtime-config";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const webCaddyfile = readFileSync(new URL("../docker/Caddyfile", import.meta.url), "utf8");
const runtimeGatewayCaddyfile = readFileSync(
  new URL("../docker/runtime-gateway.Caddyfile", import.meta.url),
  "utf8",
);
const entrypoint = readFileSync(new URL("../docker/entrypoint.ts", import.meta.url), "utf8");
const devLocal = readFileSync(new URL("../apps/api/bin/dev-local.ts", import.meta.url), "utf8");

describe("Docker runtime config", () => {
  test("generates stable required secrets and keeps optional values empty", () => {
    let sequence = 0;
    const result = buildDevVars("", {}, () => `generated-${++sequence}`);

    expect(result.generatedKeys).toEqual([
      "BETTER_AUTH_SECRET",
      "RUNTIME_ACTION_TOKEN_SECRET",
      "VAULT_ROOT_SECRET",
    ]);
    expect(result.content).toContain('BETTER_AUTH_SECRET="generated-1"');
    expect(result.content).toContain('RUNTIME_ACTION_TOKEN_SECRET="generated-2"');
    expect(result.content).toContain('VAULT_ROOT_SECRET="generated-3"');
    expect(result.content).toContain('GOOGLE_OAUTH_CLIENT_ID=""');
  });

  test("preserves generated secrets across restarts and applies explicit overrides", () => {
    const existing = [
      'BETTER_AUTH_SECRET="auth-stable"',
      'RUNTIME_ACTION_TOKEN_SECRET="runtime-stable"',
      'VAULT_ROOT_SECRET="vault-stable"',
      'GOOGLE_OAUTH_CLIENT_ID="old-client"',
      "",
    ].join("\n");

    const result = buildDevVars(
      existing,
      {
        GOOGLE_OAUTH_CLIENT_ID: "new-client",
        GOOGLE_OAUTH_CLIENT_SECRET: 'secret with "quotes"',
      },
      () => {
        throw new Error("must not regenerate stable required values");
      },
    );

    expect(result.generatedKeys).toEqual([]);
    expect(result.content).toContain('BETTER_AUTH_SECRET="auth-stable"');
    expect(result.content).toContain('RUNTIME_ACTION_TOKEN_SECRET="runtime-stable"');
    expect(result.content).toContain('VAULT_ROOT_SECRET="vault-stable"');
    expect(result.content).toContain('GOOGLE_OAUTH_CLIENT_ID="new-client"');
    expect(result.content).toContain('GOOGLE_OAUTH_CLIENT_SECRET="secret with \\"quotes\\""');
  });

  test("clears a persisted optional value when an explicit empty override is provided", () => {
    const existing = [
      'BETTER_AUTH_SECRET="auth-stable"',
      'RUNTIME_ACTION_TOKEN_SECRET="runtime-stable"',
      'VAULT_ROOT_SECRET="vault-stable"',
      'GOOGLE_OAUTH_CLIENT_ID="old-client"',
      "",
    ].join("\n");

    const result = buildDevVars(existing, { GOOGLE_OAUTH_CLIENT_ID: "" }, () => "unused");

    expect(result.content).toContain('GOOGLE_OAUTH_CLIENT_ID=""');
    expect(result.content).not.toContain("old-client");
  });

  test("rejects multiline values instead of writing an ambiguous dotenv file", () => {
    expect(() =>
      buildDevVars("", { GOOGLE_OAUTH_CLIENT_SECRET: "first\nsecond" }, () => "generated-secret"),
    ).toThrow("GOOGLE_OAUTH_CLIENT_SECRET must not contain a newline");
  });

  test("does not replace a stable required secret with whitespace", () => {
    const existing = [
      'BETTER_AUTH_SECRET="auth-stable"',
      'RUNTIME_ACTION_TOKEN_SECRET="runtime-stable"',
      'VAULT_ROOT_SECRET="vault-stable"',
      "",
    ].join("\n");

    const result = buildDevVars(existing, { BETTER_AUTH_SECRET: "   " }, () => "unused");

    expect(result.content).toContain('BETTER_AUTH_SECRET="auth-stable"');
  });

  test("fails closed when a loopback development origin is exposed publicly", () => {
    expect(() =>
      validateWebExposure({
        MOSOO_WEB_BIND_IP: "0.0.0.0",
        WEB_ORIGIN: "http://localhost:8080",
      }),
    ).toThrow("would expose the development login backdoor");
    expect(() =>
      validateWebExposure({
        MOSOO_WEB_BIND_IP: "::",
        WEB_ORIGIN: "http://127.0.0.1:8080",
      }),
    ).toThrow("would expose the development login backdoor");

    expect(() =>
      validateWebExposure({
        MOSOO_WEB_BIND_IP: "127.0.0.1",
        WEB_ORIGIN: "http://localhost:8080",
      }),
    ).not.toThrow();
    expect(() =>
      validateWebExposure({
        MOSOO_WEB_BIND_IP: "0.0.0.0",
        WEB_ORIGIN: "https://mosoo.example.com",
      }),
    ).not.toThrow();
  });

  test("atomically persists secrets and enforces owner-only permissions at every boot", () => {
    expect(entrypoint).toContain("await file.sync()");
    expect(entrypoint).toContain("await rename(temporaryDevVarsPath, persistedDevVarsPath)");
    expect(entrypoint).toContain("await chmod(persistedDevVarsPath, 0o600)");
  });

  test("shares the Docker daemon host network without exposing the internal API", () => {
    expect(compose.match(/network_mode: host/gu)).toHaveLength(2);
    expect(compose).not.toContain("\n    ports:");
    expect(compose).toContain('WRANGLER_DEV_IP: "127.0.0.1"');
    expect(compose).toContain('WRANGLER_DEV_PORT: "${MOSOO_API_PORT:-8788}"');

    expect(dockerfile).toContain("MOSOO_WEB_BIND_IP=127.0.0.1");
    expect(dockerfile).toContain('web_host="${MOSOO_WEB_BIND_IP:-127.0.0.1}"');
    expect(dockerfile).toContain('"0.0.0.0") web_host="127.0.0.1"');
    expect(dockerfile).toContain('"::") web_host="[::1]"');
    expect(dockerfile).toContain('*:*) web_host="[${web_host}]"');
    expect(dockerfile).toContain('"http://${web_host}:${MOSOO_WEB_PORT:-8080}/api/health"');
    expect(dockerfile).not.toContain('"http://127.0.0.1:${MOSOO_WEB_PORT:-8080}/api/health"');
    expect(compose).toContain('MOSOO_WEB_BIND_IP: "${MOSOO_WEB_BIND_IP:-127.0.0.1}"');
    expect(webCaddyfile).toContain(":{$MOSOO_WEB_PORT:8080}");
    expect(webCaddyfile).toContain("bind {$MOSOO_WEB_BIND_IP:127.0.0.1}");
    expect(webCaddyfile).toContain("reverse_proxy 127.0.0.1:{$WRANGLER_DEV_PORT:8788}");

    expect(runtimeGatewayCaddyfile).toContain(":{$MOSOO_RUNTIME_CONTROL_PORT:8787}");
    expect(runtimeGatewayCaddyfile).toContain("bind {$MOSOO_RUNTIME_BIND_IP:172.17.0.1}");
    expect(runtimeGatewayCaddyfile).toContain("reverse_proxy 127.0.0.1:{$WRANGLER_DEV_PORT:8788}");
    expect(compose).toContain('"0.0.0.0") gateway_host="127.0.0.1"');
    expect(compose).toContain('"::") gateway_host="[::1]"');
    expect(compose).toContain('*:*) gateway_host="[$${gateway_host}]"');
    expect(compose).toContain("/config:size=16m,mode=0700");
    expect(compose).toContain("/data:size=16m,mode=0700");
  });

  test("lets Docker pin Wrangler to loopback while preserving the dev default", () => {
    expect(devLocal).toContain(
      'const wranglerIp = wranglerEnv.WRANGLER_DEV_IP?.trim() ?? "0.0.0.0";',
    );
    expect(devLocal).toContain("Bun.file(apiVpBin).exists()");
    expect(devLocal).toContain("`${repoRoot}/node_modules/.bin/vp`");
    expect(devLocal).toContain('"--ip",\n    wranglerIp,');
    expect(devLocal).toContain('process.on("SIGTERM", onSigterm)');
    expect(devLocal).toContain('child.kill("SIGTERM")');
  });
});
