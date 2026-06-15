import { vendorCredentialsTable } from "@mosoo/db";
import type { AppId, VendorCredentialId } from "@mosoo/id";
import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { VendorCredentialRow } from "./vendor-credential.types";

function selectVendorCredentialRows(database: D1Database) {
  return getAppDatabase(database)
    .select({
      apiBase: vendorCredentialsTable.apiBase,
      apiKeySecretId: vendorCredentialsTable.apiKeySecretId,
      id: vendorCredentialsTable.id,
      modelsJson: vendorCredentialsTable.models,
      name: vendorCredentialsTable.name,
      appId: vendorCredentialsTable.appId,
      vendorId: vendorCredentialsTable.vendorId,
    })
    .from(vendorCredentialsTable);
}

export async function listAppCustomCredentialRows(
  database: D1Database,
  appId: AppId,
): Promise<VendorCredentialRow[]> {
  return selectVendorCredentialRows(database)
    .where(
      and(
        eq(vendorCredentialsTable.appId, appId),
        eq(vendorCredentialsTable.vendorId, "openai-compatible"),
      ),
    )
    .orderBy(asc(vendorCredentialsTable.name), asc(vendorCredentialsTable.id))
    .all();
}

export async function listAppVendorCredentialRows(
  database: D1Database,
  appId: AppId,
): Promise<VendorCredentialRow[]> {
  return selectVendorCredentialRows(database)
    .where(eq(vendorCredentialsTable.appId, appId))
    .orderBy(
      asc(vendorCredentialsTable.vendorId),
      asc(vendorCredentialsTable.name),
      asc(vendorCredentialsTable.id),
    )
    .all();
}

export async function getCredentialRow(
  database: D1Database,
  id: VendorCredentialId,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(eq(vendorCredentialsTable.id, id))
      .limit(1)
      .get()) ?? null
  );
}

export async function getAppCredentialRow(
  database: D1Database,
  appId: AppId,
  id: VendorCredentialId,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(and(eq(vendorCredentialsTable.id, id), eq(vendorCredentialsTable.appId, appId)))
      .limit(1)
      .get()) ?? null
  );
}

export async function getAppVendorCredentialRow(
  database: D1Database,
  appId: AppId,
  vendorId: string,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(
        and(eq(vendorCredentialsTable.appId, appId), eq(vendorCredentialsTable.vendorId, vendorId)),
      )
      .orderBy(asc(vendorCredentialsTable.name), asc(vendorCredentialsTable.id))
      .limit(1)
      .get()) ?? null
  );
}
