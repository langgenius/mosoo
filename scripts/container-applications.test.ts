import { describe, expect, test } from "bun:test";

import { containerApplicationNames } from "./container-applications";
import type { WranglerConfig } from "./container-applications";

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

  test("rejects an unknown environment", () => {
    expect(() => containerApplicationNames({ name: "worker" }, "prod")).toThrow(
      "wrangler config has no [env.prod] section.",
    );
  });
});
