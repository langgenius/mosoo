import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../domain/authenticated-viewer";

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
