import { vaultSecretsTable } from "@mosoo/db";
import type { EnvironmentId, PlatformId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { readSecretOutcome, storeSecret } from "../../mcp/application/mcp-secret-store";

export type EnvironmentSecretReadPurpose = "runtime_snapshot_hydration";

interface EnvironmentVariableSecretOwner {
  readonly environmentId: EnvironmentId;
  readonly envVarKey: string;
}

function toEnvironmentVariableSecretKind(owner: EnvironmentVariableSecretOwner): string {
  return `environment:${owner.environmentId}:${owner.envVarKey}`;
}

export async function storeEnvironmentVariableSecret(
  bindings: ApiBindings,
  input: EnvironmentVariableSecretOwner & {
    readonly value: string;
  },
): Promise<PlatformId> {
  return storeSecret(bindings.DB, bindings, {
    kind: toEnvironmentVariableSecretKind(input),
    value: input.value,
  });
}

export async function readEnvironmentVariableSecret(
  bindings: ApiBindings,
  input: EnvironmentVariableSecretOwner & {
    readonly purpose: EnvironmentSecretReadPurpose;
    readonly secretId: string;
  },
): Promise<string> {
  if (input.purpose !== "runtime_snapshot_hydration") {
    throw validationError("Environment variable secret purpose is invalid.");
  }

  const row =
    (await getAppDatabase(bindings.DB)
      .select({ kind: vaultSecretsTable.kind })
      .from(vaultSecretsTable)
      .where(eq(vaultSecretsTable.id, parsePlatformId(input.secretId, "secretId")))
      .limit(1)
      .get()) ?? null;

  if (!row || row.kind !== toEnvironmentVariableSecretKind(input)) {
    throw validationError("Environment variable secret is unavailable.");
  }

  const secret = await readSecretOutcome(bindings.DB, bindings, input.secretId);

  if (secret.status === "missing") {
    throw validationError("Environment variable secret is unavailable.");
  }

  return secret.value;
}
