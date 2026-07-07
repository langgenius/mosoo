import { accountsTable } from "@mosoo/db";
import type { AccountId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../domain/authenticated-viewer";
import { authenticatePersonalAccessToken, readBearerToken } from "./personal-access-token.service";

export type { AuthenticatedViewer };

function isSessionAuthConfigured(bindings: Pick<ApiBindings, "BETTER_AUTH_SECRET">): boolean {
  return Boolean(bindings.BETTER_AUTH_SECRET?.trim());
}

export async function getViewerFromRequest(
  bindings: ApiBindings,
  request: Request,
): Promise<AuthenticatedViewer | null> {
  if (!isSessionAuthConfigured(bindings)) {
    return null;
  }

  const { getViewerFromRequest: readViewerFromRequest } =
    await import("../infrastructure/session-auth");

  return readViewerFromRequest(bindings, request);
}

export async function getAuthenticatedViewerFromRequest(
  bindings: ApiBindings,
  request: Request,
): Promise<AuthenticatedViewer | null> {
  const sessionViewer = await getViewerFromRequest(bindings, request);
  if (sessionViewer) {
    return sessionViewer;
  }

  const token = readBearerToken(request);
  if (!token) {
    return null;
  }

  const tokenCaller = await authenticatePersonalAccessToken(bindings.DB, token);
  return tokenCaller?.viewer ?? null;
}

/**
 * Loads a viewer straight from an account row, for flows that act on behalf
 * of a known account without a live request (CLI OAuth token minting, native
 * repo deploys running as the App owner). Returns null when the account no
 * longer exists.
 */
export async function loadViewerByAccountId(
  database: D1Database,
  accountId: AccountId,
): Promise<AuthenticatedViewer | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        email: accountsTable.email,
        emailVerified: accountsTable.emailVerified,
        id: accountsTable.id,
        imageUrl: accountsTable.image,
        name: accountsTable.name,
      })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    email: row.email,
    emailVerified: row.emailVerified,
    id: row.id,
    imageUrl: row.imageUrl,
    name: row.name,
  };
}
