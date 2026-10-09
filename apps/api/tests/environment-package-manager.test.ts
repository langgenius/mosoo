import { describe, expect, test } from "bun:test";

import type {
  EnvironmentConfigInput,
  EnvironmentPackageManager,
} from "@mosoo/contracts/environment";
import { createPlatformId } from "@mosoo/id";
import type { ProjectId } from "@mosoo/id";

import {
  normalizeEnvironmentConfigInput,
  parsePackagesJson,
} from "../src/modules/environments/application/environment-config";
import { resolveReadyEnvironmentPackageArtifact } from "../src/modules/environments/application/environment-package-artifact.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const LEGACY_MANAGERS = [
  "apt",
  "cargo",
  "gem",
  "go",
] as const satisfies readonly EnvironmentPackageManager[];

function configWithPackage(manager: EnvironmentPackageManager): EnvironmentConfigInput {
  return {
    allowedHosts: [],
    envVars: [],
    networkPolicy: "full",
    packages: [{ manager, packages: ["example@1.0.0"] }],
    setupScript: "",
  };
}

describe("Environment package managers", () => {
  test("reads package managers retained by existing Environment revisions", () => {
    const parsed = parsePackagesJson(
      JSON.stringify(LEGACY_MANAGERS.map((manager) => ({ manager, packages: ["legacy"] }))),
    );

    expect(parsed.map((entry) => entry.manager)).toEqual(LEGACY_MANAGERS);
  });

  test.each(LEGACY_MANAGERS)("rejects new %s writes with an actionable error", (manager) => {
    expect(() => normalizeEnvironmentConfigInput(configWithPackage(manager))).toThrow(
      `Package manager ${manager} is not supported by the current Driver runtime. Remove it or replace it with npm or pip before saving.`,
    );
  });

  test.each(LEGACY_MANAGERS)(
    "rejects a frozen %s revision before artifact infrastructure access",
    async (manager) => {
      let bindingAccessed = false;
      const bindings = new Proxy({} as ApiBindings, {
        get() {
          bindingAccessed = true;
          throw new Error("Artifact infrastructure must not be accessed.");
        },
      });

      await expect(
        resolveReadyEnvironmentPackageArtifact(
          bindings,
          createPlatformId<ProjectId>(),
          JSON.stringify([{ manager, packages: ["legacy"] }]),
        ),
      ).rejects.toThrow(
        `Package manager ${manager} is not supported by the current Driver runtime. Remove it or replace it with npm or pip before saving.`,
      );
      expect(bindingAccessed).toBe(false);
    },
  );
});
