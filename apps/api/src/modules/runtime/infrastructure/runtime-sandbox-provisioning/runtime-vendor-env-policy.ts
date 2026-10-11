import { ALL_VENDORS } from "@mosoo/runtime-catalog";

export const OPENCODE_CONFIG_CONTENT_ENV = "OPENCODE_CONFIG_CONTENT";

const RUNTIME_MANAGED_VENDOR_ENV_NAMES = new Set<string>([
  OPENCODE_CONFIG_CONTENT_ENV,
  ...ALL_VENDORS.map((vendor) => vendor.apiKeyEnvVar),
  ...ALL_VENDORS.flatMap((vendor) =>
    vendor.apiBaseEnvVar === undefined ? [] : [vendor.apiBaseEnvVar],
  ),
]);

export function sanitizeRuntimeVendorEnvVars(
  envVars: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(envVars).filter(([name]) => !RUNTIME_MANAGED_VENDOR_ENV_NAMES.has(name)),
  );
}
