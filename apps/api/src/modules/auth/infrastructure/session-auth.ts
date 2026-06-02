import { parsePlatformId } from "@mosoo/id";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../domain/authenticated-viewer";
import { getBetterAuth, isBetterAuthConfigured } from "./better-auth";

export type { AuthenticatedViewer };

export async function getViewerFromRequest(
  bindings: ApiBindings,
  request: Request,
): Promise<AuthenticatedViewer | null> {
  if (!isBetterAuthConfigured(bindings)) {
    return null;
  }

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
