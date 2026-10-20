import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { getWorkerUserAgent } from "../src/platform/cloudflare/worker-user-agent";

test("Given no deployment metadata, When running locally, Then identify a development build", () => {
  expect(getWorkerUserAgent()).toBe("mosoo/dev");
  expect(getWorkerUserAgent({ id: "" })).toBe("mosoo/dev");
});

test("Given a new Worker deployment, When constructing client identity, Then use its version ID", () => {
  expect(getWorkerUserAgent({ id: "release-a" })).toBe("mosoo/release-a");
  expect(getWorkerUserAgent({ id: "release-b" })).toBe("mosoo/release-b");
});

test("Given any API environment, When deployed, Then Cloudflare injects version metadata", () => {
  const config = Bun.TOML.parse(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"));
  const environments = config.env as Record<string, Record<string, unknown>>;
  for (const environment of [config, environments.stage, environments.prod]) {
    expect(environment?.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
  }
});
