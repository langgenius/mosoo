import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MOSOO_CONSOLE_HOST,
  MOSOO_CONSOLE_ORIGIN,
  MOSOO_GOOGLE_OAUTH_CALLBACK_URL,
  MOSOO_LEGACY_CONSOLE_HOST,
  MOSOO_LEGACY_PRODUCTION_API_ROUTE_PATTERN,
  MOSOO_MARKETING_HOST,
  MOSOO_PRODUCTION_API_ROUTE_PATTERN,
} from "@mosoo/contracts/origin";

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("production origins", () => {
  test("pins the production Sandbox capacity accepted by the account quota", () => {
    const apiWrangler = readRepoFile("apps/api/wrangler.toml");

    expect(apiWrangler).toContain('instance_type = "standard-2"\nmax_instances = 500');
  });

  test("keeps Cloudflare routes and OAuth origin aligned", () => {
    const apiWrangler = readRepoFile("apps/api/wrangler.toml");
    const webWrangler = readRepoFile("apps/web/wrangler.toml");

    expect(apiWrangler).toContain(`WEB_ORIGIN = "${MOSOO_CONSOLE_ORIGIN}"`);
    expect(apiWrangler).toContain(`pattern = "${MOSOO_PRODUCTION_API_ROUTE_PATTERN}"`);
    expect(apiWrangler).toContain(`pattern = "${MOSOO_LEGACY_PRODUCTION_API_ROUTE_PATTERN}"`);
    expect(apiWrangler).toContain('"GOOGLE_OAUTH_CLIENT_ID"');
    expect(apiWrangler).toContain('"GOOGLE_OAUTH_CLIENT_SECRET"');
    expect(webWrangler).toContain(`pattern = "${MOSOO_CONSOLE_HOST}"`);
    expect(webWrangler).toContain(`pattern = "${MOSOO_LEGACY_CONSOLE_HOST}"`);
    expect(webWrangler).toContain("run_worker_first = true");
    expect(webWrangler).not.toContain(`pattern = "${MOSOO_MARKETING_HOST}"`);
  });

  test("documents the marketing and console split", () => {
    const architecture = readRepoFile("docs/architecture.md");
    const contributing = readRepoFile("CONTRIBUTING.md");

    expect(architecture).toContain(
      `\`${MOSOO_MARKETING_HOST}\` is the marketing / landing / blog origin`,
    );
    expect(architecture).toContain(`${MOSOO_PRODUCTION_API_ROUTE_PATTERN}`);
    expect(contributing).toContain(`${MOSOO_PRODUCTION_API_ROUTE_PATTERN}`);
  });

  test("defines the production Google OAuth callback", () => {
    expect(MOSOO_GOOGLE_OAUTH_CALLBACK_URL).toBe(
      `${MOSOO_CONSOLE_ORIGIN}/api/auth/callback/google`,
    );
  });
});
