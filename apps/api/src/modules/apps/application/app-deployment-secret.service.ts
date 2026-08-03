import type {
  AppDeploymentSecret,
  DeleteAppDeploymentSecretInput,
  SetAppDeploymentSecretInput,
} from "@mosoo/contracts/app";
import { appDeploymentSecretsTable, vaultSecretsTable } from "@mosoo/db";
import type { AppId, PlatformId } from "@mosoo/id";
import { and, asc, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  deleteSecret,
  readSecretOutcome,
  replaceSecret,
  storeSecret,
} from "../../vault/application/vault-secret-store";
import { ensureAppOwnership } from "./app.service";

const APP_DEPLOYMENT_SECRET_KIND = "app_deployment";
const APP_DEPLOYMENT_SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;

interface AppDeploymentSecretRow {
  appId: AppId;
  createdAt: number;
  name: string;
  updatedAt: number;
  vaultSecretId: PlatformId;
}

export class AppDeploymentSecretResolutionError extends Error {
  readonly code = "deployment_required_secret_missing";

  constructor(names: readonly string[]) {
    super(
      `Deployment requires configured App secret${names.length === 1 ? "" : "s"}: ${names.join(
        ", ",
      )}.`,
    );
    this.name = "AppDeploymentSecretResolutionError";
  }
}

function normalizeSecretName(value: string): string {
  if (!APP_DEPLOYMENT_SECRET_NAME.test(value)) {
    throw validationError(
      "Secret name must start with a letter or underscore and contain only letters, digits, and underscores.",
    );
  }

  return value;
}

function validateSecretValue(value: string): string {
  if (value.trim() === "") {
    throw validationError("Secret value must not be empty.");
  }

  return value;
}

function toAppDeploymentSecret(row: AppDeploymentSecretRow): AppDeploymentSecret {
  return {
    appId: row.appId,
    createdAt: toIsoString(row.createdAt),
    name: row.name,
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function readAppDeploymentSecretRow(
  database: D1Database,
  appId: AppId,
  name: string,
): Promise<AppDeploymentSecretRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        appId: appDeploymentSecretsTable.appId,
        createdAt: appDeploymentSecretsTable.createdAt,
        name: appDeploymentSecretsTable.name,
        updatedAt: vaultSecretsTable.updatedAt,
        vaultSecretId: appDeploymentSecretsTable.vaultSecretId,
      })
      .from(appDeploymentSecretsTable)
      .innerJoin(
        vaultSecretsTable,
        eq(appDeploymentSecretsTable.vaultSecretId, vaultSecretsTable.id),
      )
      .where(
        and(eq(appDeploymentSecretsTable.appId, appId), eq(appDeploymentSecretsTable.name, name)),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function listAppDeploymentSecrets(
  bindings: Pick<ApiBindings, "DB">,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<AppDeploymentSecret[]> {
  await ensureAppOwnership(bindings.DB, viewer.id, appId);

  const rows = await getAppDatabase(bindings.DB)
    .select({
      appId: appDeploymentSecretsTable.appId,
      createdAt: appDeploymentSecretsTable.createdAt,
      name: appDeploymentSecretsTable.name,
      updatedAt: vaultSecretsTable.updatedAt,
      vaultSecretId: appDeploymentSecretsTable.vaultSecretId,
    })
    .from(appDeploymentSecretsTable)
    .innerJoin(vaultSecretsTable, eq(appDeploymentSecretsTable.vaultSecretId, vaultSecretsTable.id))
    .where(eq(appDeploymentSecretsTable.appId, appId))
    .orderBy(asc(appDeploymentSecretsTable.name))
    .all();

  return rows.map(toAppDeploymentSecret);
}

export async function setAppDeploymentSecret(
  bindings: Pick<ApiBindings, "DB" | "VAULT_ROOT_SECRET">,
  viewer: AuthenticatedViewer,
  input: SetAppDeploymentSecretInput,
): Promise<AppDeploymentSecret> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const name = normalizeSecretName(input.name);
  const value = validateSecretValue(input.value);
  const existing = await readAppDeploymentSecretRow(bindings.DB, input.appId, name);

  if (existing !== null) {
    await replaceSecret(bindings.DB, bindings, { secretId: existing.vaultSecretId, value });
    const updated = await readAppDeploymentSecretRow(bindings.DB, input.appId, name);

    if (updated === null) {
      throw new Error("App deployment secret could not be loaded after rotation.");
    }

    return toAppDeploymentSecret(updated);
  }

  const vaultSecretId = await storeSecret(bindings.DB, bindings, {
    kind: APP_DEPLOYMENT_SECRET_KIND,
    value,
  });

  try {
    const insert = await getAppDatabase(bindings.DB)
      .insert(appDeploymentSecretsTable)
      .values({
        appId: input.appId,
        createdAt: currentTimestampMs(),
        name,
        vaultSecretId,
      })
      .onConflictDoNothing()
      .run();

    if (getD1ChangeCount(insert) === 0) {
      await deleteSecret(bindings.DB, vaultSecretId);
      return setAppDeploymentSecret(bindings, viewer, input);
    }
  } catch (error) {
    await deleteSecret(bindings.DB, vaultSecretId).catch(() => undefined);
    throw error;
  }

  const created = await readAppDeploymentSecretRow(bindings.DB, input.appId, name);

  if (created === null) {
    throw new Error("App deployment secret could not be loaded after creation.");
  }

  return toAppDeploymentSecret(created);
}

export async function deleteAppDeploymentSecret(
  bindings: Pick<ApiBindings, "DB">,
  viewer: AuthenticatedViewer,
  input: DeleteAppDeploymentSecretInput,
): Promise<void> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  const name = normalizeSecretName(input.name);
  const existing = await readAppDeploymentSecretRow(bindings.DB, input.appId, name);

  if (existing === null) {
    return;
  }

  await runAppDatabaseBatch(bindings.DB, (database) => [
    database
      .delete(appDeploymentSecretsTable)
      .where(
        and(
          eq(appDeploymentSecretsTable.appId, input.appId),
          eq(appDeploymentSecretsTable.name, name),
        ),
      ),
    database.delete(vaultSecretsTable).where(eq(vaultSecretsTable.id, existing.vaultSecretId)),
  ]);
}

/** Remove all app-deployment secrets only after the managed Worker is gone. */
export async function deleteAppDeploymentSecretsForApp(
  database: D1Database,
  appId: AppId,
): Promise<void> {
  const rows = await getAppDatabase(database)
    .select({ vaultSecretId: appDeploymentSecretsTable.vaultSecretId })
    .from(appDeploymentSecretsTable)
    .where(eq(appDeploymentSecretsTable.appId, appId))
    .all();

  if (rows.length === 0) {
    return;
  }

  const vaultSecretIds = rows.map((row) => row.vaultSecretId);
  await runAppDatabaseBatch(database, (db) => [
    db.delete(appDeploymentSecretsTable).where(eq(appDeploymentSecretsTable.appId, appId)),
    db.delete(vaultSecretsTable).where(inArray(vaultSecretsTable.id, vaultSecretIds)),
  ]);
}

/**
 * Checks that every manifest-declared name still has an App-owned secret
 * without decrypting a value before the Worker submission boundary.
 */
export async function assertAppDeploymentSecretNamesAvailable(
  bindings: Pick<ApiBindings, "DB">,
  input: { appId: AppId; names: readonly string[] },
): Promise<void> {
  const names = [...new Set(input.names)];

  if (names.length === 0) {
    return;
  }

  const rows = await getAppDatabase(bindings.DB)
    .select({ name: appDeploymentSecretsTable.name })
    .from(appDeploymentSecretsTable)
    .where(
      and(
        eq(appDeploymentSecretsTable.appId, input.appId),
        inArray(appDeploymentSecretsTable.name, names),
      ),
    )
    .all();
  const configuredNames = new Set(rows.map((row) => row.name));
  const missing = names.filter((name) => !configuredNames.has(name));

  if (missing.length > 0) {
    throw new AppDeploymentSecretResolutionError(missing);
  }
}

/**
 * Resolve only names declared in the repository manifest. Values are returned
 * at the final Cloudflare upload boundary and must never enter a plan,
 * generated Wrangler config, build sandbox, log, or API response.
 */
export async function resolveAppDeploymentSecretValues(
  bindings: Pick<ApiBindings, "DB" | "VAULT_ROOT_SECRET">,
  input: { appId: AppId; names: readonly string[] },
): Promise<Record<string, string>> {
  const names = [...new Set(input.names)];

  if (names.length === 0) {
    return {};
  }

  const rows = await getAppDatabase(bindings.DB)
    .select({
      name: appDeploymentSecretsTable.name,
      vaultSecretId: appDeploymentSecretsTable.vaultSecretId,
    })
    .from(appDeploymentSecretsTable)
    .where(
      and(
        eq(appDeploymentSecretsTable.appId, input.appId),
        inArray(appDeploymentSecretsTable.name, names),
      ),
    )
    .all();
  const secretByName = new Map(rows.map((row) => [row.name, row.vaultSecretId]));
  const missing = names.filter((name) => !secretByName.has(name));

  if (missing.length > 0) {
    throw new AppDeploymentSecretResolutionError(missing);
  }

  const values = await Promise.all(
    names.map(async (name) => {
      const secretId = secretByName.get(name);

      if (secretId === undefined) {
        throw new AppDeploymentSecretResolutionError([name]);
      }

      const outcome = await readSecretOutcome(bindings.DB, bindings, secretId);

      if (outcome.status === "missing") {
        throw new AppDeploymentSecretResolutionError([name]);
      }

      return [name, outcome.value] as const;
    }),
  );

  return Object.fromEntries(values);
}
