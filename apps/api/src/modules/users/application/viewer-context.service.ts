import type { AccountProfile, UpdateAccountProfileInput, Viewer } from "@mosoo/contracts/account";
import { accountsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { requireName } from "../../../shared/require-name";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { normalizeAccountImageUrl } from "../domain/user-avatar";
import { listViewerOrganizations } from "./account-organization-context.service";

function createAccountProfile(viewer: AuthenticatedViewer): AccountProfile {
  return {
    email: viewer.email,
    id: viewer.id,
    imageUrl: viewer.imageUrl,
    name: viewer.name,
  };
}

export async function getViewer(
  database: D1Database,
  viewer: AuthenticatedViewer | null,
): Promise<Viewer> {
  if (!viewer) {
    return {
      account: null,
      activeOrganization: null,
      organizations: [],
    };
  }

  const [account, organizations] = await Promise.all([
    getAppDatabase(database)
      .select({ imageUrl: accountsTable.image, name: accountsTable.name })
      .from(accountsTable)
      .where(eq(accountsTable.id, viewer.id))
      .limit(1)
      .get(),
    listViewerOrganizations(database, viewer.id),
  ]);

  if (!account) {
    throw new Error("Account not found.");
  }

  return {
    account: createAccountProfile({ ...viewer, imageUrl: account.imageUrl, name: account.name }),
    activeOrganization: organizations[0] ?? null,
    organizations,
  };
}

export async function updateProfile(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateAccountProfileInput,
): Promise<AccountProfile> {
  const name = requireName(input.name, "Name");
  const imageProvided = Object.prototype.hasOwnProperty.call(input, "imageUrl");
  const imageUrl = imageProvided ? normalizeAccountImageUrl(input.imageUrl) : viewer.imageUrl;

  const updates: { image?: string | null; name: string; updatedAt: number } = {
    name,
    updatedAt: currentTimestampMs(),
  };

  if (imageProvided) {
    updates.image = imageUrl;
  }

  await getAppDatabase(database)
    .update(accountsTable)
    .set(updates)
    .where(eq(accountsTable.id, viewer.id))
    .run();

  return createAccountProfile({ ...viewer, imageUrl, name });
}
