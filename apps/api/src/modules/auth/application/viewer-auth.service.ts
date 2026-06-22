import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
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
