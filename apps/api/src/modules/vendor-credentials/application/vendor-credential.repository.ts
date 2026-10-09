import { vendorCredentialsTable } from "@mosoo/db";
import type { ProjectId, VendorCredentialId } from "@mosoo/id";
import { and, asc, desc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { VendorCredentialRow } from "./vendor-credential.types";

function selectVendorCredentialRows(database: D1Database) {
  return getAppDatabase(database)
    .select({
      apiBase: vendorCredentialsTable.apiBase,
      apiKeySecretId: vendorCredentialsTable.apiKeySecretId,
      id: vendorCredentialsTable.id,
      isDefault: vendorCredentialsTable.isDefault,
      modelProtocol: vendorCredentialsTable.modelProtocol,
      modelsJson: vendorCredentialsTable.models,
      name: vendorCredentialsTable.name,
      projectId: vendorCredentialsTable.projectId,
      vendorId: vendorCredentialsTable.vendorId,
    })
    .from(vendorCredentialsTable);
}

export async function listProjectCustomCredentialRows(
  database: D1Database,
  projectId: ProjectId,
): Promise<VendorCredentialRow[]> {
  return selectVendorCredentialRows(database)
    .where(
      and(
        eq(vendorCredentialsTable.projectId, projectId),
        eq(vendorCredentialsTable.vendorId, "openai-compatible"),
      ),
    )
    .orderBy(asc(vendorCredentialsTable.name), asc(vendorCredentialsTable.id))
    .all();
}

export async function listProjectVendorCredentialRows(
  database: D1Database,
  projectId: ProjectId,
): Promise<VendorCredentialRow[]> {
  return selectVendorCredentialRows(database)
    .where(eq(vendorCredentialsTable.projectId, projectId))
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

export async function getProjectCredentialRow(
  database: D1Database,
  projectId: ProjectId,
  id: VendorCredentialId,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(
        and(eq(vendorCredentialsTable.id, id), eq(vendorCredentialsTable.projectId, projectId)),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function getProjectVendorCredentialRow(
  database: D1Database,
  projectId: ProjectId,
  vendorId: string,
): Promise<VendorCredentialRow | null> {
  return (
    (await selectVendorCredentialRows(database)
      .where(
        and(
          eq(vendorCredentialsTable.projectId, projectId),
          eq(vendorCredentialsTable.vendorId, vendorId),
        ),
      )
      .orderBy(
        desc(vendorCredentialsTable.isDefault),
        asc(vendorCredentialsTable.name),
        asc(vendorCredentialsTable.id),
      )
      .limit(1)
      .get()) ?? null
  );
}
