import type { JsonObject } from "@mosoo/contracts";
import { validateRuntimeAdvancedSettings } from "@mosoo/runtime-catalog";

export function assertRuntimeAdvancedSettings(input: {
  readonly allowLegacyUnsupportedSettings?: boolean;
  readonly modelId: string;
  readonly runtimeId: string;
  readonly settings: JsonObject;
}): JsonObject {
  const validation = validateRuntimeAdvancedSettings({
    modelId: input.modelId,
    runtimeId: input.runtimeId,
    settings: input.settings,
  });

  const blockingIssues =
    input.allowLegacyUnsupportedSettings === true
      ? validation.issues.filter((issue) => issue.code === "runtime_settings_security_boundary")
      : validation.issues;

  if (blockingIssues.length > 0) {
    throw new Error(blockingIssues.map((issue) => issue.message).join(" "));
  }

  return validation.ok ? validation.normalizedSettings : input.settings;
}
