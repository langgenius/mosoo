import { describe, expect, test } from "bun:test";

import { containerApplicationNames } from "./container-applications";
import type { WranglerConfig } from "./container-applications";

async function readApiWranglerConfig(): Promise<WranglerConfig> {
  const source = await Bun.file(new URL("../apps/api/wrangler.toml", import.meta.url)).text();
  return Bun.TOML.parse(source) as WranglerConfig;
}

describe("container applications", () => {
  test("derives wrangler application names for an environment", () => {
    const config: WranglerConfig = {
      env: {
        prod: {
          containers: [{ class_name: "SandboxPi" }, { class_name: "Builder", name: "builder-app" }],
          name: "worker-prod",
        },
      },
      name: "worker",
    };

    expect(containerApplicationNames(config, "prod")).toEqual([
      "worker-prod-sandboxpi-prod",
      "builder-app",
    ]);
  });

  test("covers every production sandbox image the monitor must watch", async () => {
    expect(containerApplicationNames(await readApiWranglerConfig(), "prod")).toEqual([
      "mosoo-api-prod-sandboxclaude-prod",
      "mosoo-api-prod-sandboxopenai-prod",
      "mosoo-api-prod-sandboxopencode-prod",
      "mosoo-api-prod-sandboxpi-prod",
      "mosoo-api-prod-sandbox-prod",
    ]);
  });

  test("rejects an unknown environment", () => {
    expect(() => containerApplicationNames({ name: "worker" }, "prod")).toThrow(
      "wrangler config has no [env.prod] section.",
    );
  });
});
