import { describe, expect, test } from "bun:test";

import {
  createPackageRow,
  getPackageManagerError,
  PACKAGE_MANAGERS,
} from "../src/domains/environment/components/environment-form-model";
import en from "../src/shared/i18n/translations/en.json";

const environmentCopy: Record<string, string> = en.environments;

function t(key: string, variables: Record<string, string> = {}): string {
  return Object.entries(variables).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    environmentCopy[key.replace("environments.", "")] ?? key,
  );
}

describe("Environment form package managers", () => {
  test("offers only package managers guaranteed by the Driver image", () => {
    expect(PACKAGE_MANAGERS).toEqual(["npm", "pip"]);
  });

  test("keeps a legacy manager visible with an actionable migration error", () => {
    const error = getPackageManagerError([createPackageRow("cargo", "ripgrep@14.1.1")], t);

    expect(error).toBe(
      "cargo is not supported by the current Driver runtime. Change it to npm or pip, or remove this row before saving.",
    );
  });

  test("allows clearing an unsupported package row before saving", () => {
    expect(getPackageManagerError([createPackageRow("cargo", "")], t)).toBeNull();
  });
});
