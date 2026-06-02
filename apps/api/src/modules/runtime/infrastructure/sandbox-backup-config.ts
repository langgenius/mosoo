import { ApiError } from "../../../platform/errors";

export const SANDBOX_BACKUP_CREDENTIAL_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

export type SandboxBackupCredentialKey = (typeof SANDBOX_BACKUP_CREDENTIAL_KEYS)[number];

type SandboxBackupCredentialSource = Partial<Record<SandboxBackupCredentialKey, unknown>>;

function getMissingSandboxBackupCredentialKeys(
  source: SandboxBackupCredentialSource,
): SandboxBackupCredentialKey[] {
  return SANDBOX_BACKUP_CREDENTIAL_KEYS.filter((key) => {
    const value = source[key];

    return typeof value !== "string" || value.trim().length === 0;
  });
}

export function enforceSandboxBackupConfigured(source: SandboxBackupCredentialSource): void {
  const missingKeys = getMissingSandboxBackupCredentialKeys(source);

  if (missingKeys.length === 0) {
    return;
  }

  throw new ApiError(
    500,
    "RUNTIME_BACKUP_CONFIG_MISSING",
    `Sandbox backup is not configured. Fill ${missingKeys.join(
      ", ",
    )} in apps/api/.dev.vars or Worker secrets before recreating a sandbox preserving state.`,
  );
}
