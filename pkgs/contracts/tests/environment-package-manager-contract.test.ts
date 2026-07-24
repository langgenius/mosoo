import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  ENVIRONMENT_PACKAGE_MANAGERS,
  isWritableEnvironmentPackageManager,
  WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS,
} from "../src/environment/environment.contract";

interface DriverPackageManagerManifest {
  managers: string[];
  schemaVersion: number;
}

function readDriverManifest(): DriverPackageManagerManifest {
  return JSON.parse(
    readFileSync(
      new URL("../../../apps/driver/environment-package-managers.json", import.meta.url),
      "utf8",
    ),
  ) as DriverPackageManagerManifest;
}

describe("Environment package manager contract", () => {
  test("matches the writable product contract to Driver image capabilities", () => {
    const manifest = readDriverManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.managers).toEqual([...WRITABLE_ENVIRONMENT_PACKAGE_MANAGERS]);
  });

  test("keeps legacy managers readable without advertising them for writes", () => {
    expect(ENVIRONMENT_PACKAGE_MANAGERS).toEqual(["apt", "cargo", "gem", "go", "npm", "pip"]);
    expect(ENVIRONMENT_PACKAGE_MANAGERS.filter(isWritableEnvironmentPackageManager)).toEqual([
      "npm",
      "pip",
    ]);
  });
});
