import { accountsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../domain/authenticated-viewer";
import { authenticatePersonalAccessToken, readBearerToken } from "./personal-access-token.service";

export type { AuthenticatedViewer };

export async function getAccountViewer(
  database: D1Database,
  accountId: AccountId,
): Promise<AuthenticatedViewer | null> {
  return (
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
      .get()) ?? null
  );
}

export async function getViewerFromRequest(
  bindings: ApiBindings,
  request: Request,
): Promise<AuthenticatedViewer | null> {
  const { getBetterAuth } = await import("../infrastructure/better-auth");
  const session = await getBetterAuth(bindings).api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return null;
  }

  return {
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    id: parsePlatformId<AccountId>(session.user.id, "Viewer ID"),
    imageUrl: session.user.image ?? null,
    name: session.user.name,
  };
}

export async function getApiViewerFromRequest(
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

/** Account control-plane routes never accept application Project keys. */
export async function getAuthenticatedViewerFromRequest(
  bindings: ApiBindings,
  request: Request,
): Promise<AuthenticatedViewer | null> {
  const viewer = await getApiViewerFromRequest(bindings, request);
  return viewer?.projectId === undefined ? viewer : null;
}
