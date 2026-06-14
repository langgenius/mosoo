import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, SessionId } from "@mosoo/id";

import { isTruthy } from "../../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
export const SESSION_ID_HEADER = "x-session-id";
const VIEWER_EMAIL_HEADER = "x-viewer-email";
const VIEWER_EMAIL_VERIFIED_HEADER = "x-viewer-email-verified";
const VIEWER_ID_HEADER = "x-viewer-id";
const VIEWER_IMAGE_URL_HEADER = "x-viewer-image-url";
const VIEWER_NAME_HEADER = "x-viewer-name";
const VIEWER_ORIGIN_HEADER = "x-viewer-origin";
const VIEWER_APP_ID_HEADER = "x-viewer-app-id";
const VIEWER_SESSION_ID_HEADER = "x-viewer-session-id";

export interface SessionViewerSocketContext {
  publicOrigin: string;
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}

export function writeSessionViewerSocketHeaders(
  headers: Headers,
  input: SessionViewerSocketContext,
): void {
  headers.set(SESSION_ID_HEADER, input.sessionId);
  headers.set(VIEWER_EMAIL_HEADER, encodeURIComponent(input.viewer.email));
  headers.set(VIEWER_EMAIL_VERIFIED_HEADER, input.viewer.emailVerified ? "true" : "false");
  headers.set(VIEWER_ID_HEADER, input.viewer.id);
  headers.set(VIEWER_IMAGE_URL_HEADER, encodeURIComponent(input.viewer.imageUrl ?? ""));
  headers.set(VIEWER_NAME_HEADER, encodeURIComponent(input.viewer.name));
  headers.set(VIEWER_ORIGIN_HEADER, input.publicOrigin);
  headers.set(VIEWER_APP_ID_HEADER, input.appId);
  headers.set(VIEWER_SESSION_ID_HEADER, input.sessionId);
}

export function readSessionViewerSocketHeaders(headers: Headers): SessionViewerSocketContext {
  const viewerId = headers.get(VIEWER_ID_HEADER);
  const appId = headers.get(VIEWER_APP_ID_HEADER);
  const sessionId = headers.get(VIEWER_SESSION_ID_HEADER);
  const publicOrigin = headers.get(VIEWER_ORIGIN_HEADER);

  if (!isTruthy(viewerId) || !isTruthy(appId) || !isTruthy(sessionId) || !isTruthy(publicOrigin)) {
    throw new Error("Viewer websocket headers are incomplete.");
  }

  const imageUrl = decodeURIComponent(headers.get(VIEWER_IMAGE_URL_HEADER) ?? "");

  return {
    publicOrigin,
    appId: parsePlatformId<AppId>(appId, "Viewer socket app ID"),
    sessionId: parsePlatformId<SessionId>(sessionId, "Viewer socket session ID"),
    viewer: {
      email: decodeURIComponent(headers.get(VIEWER_EMAIL_HEADER) ?? ""),
      emailVerified: headers.get(VIEWER_EMAIL_VERIFIED_HEADER) === "true",
      id: parsePlatformId<AccountId>(viewerId, "Viewer socket viewer ID"),
      imageUrl: imageUrl.length > 0 ? imageUrl : null,
      name: decodeURIComponent(headers.get(VIEWER_NAME_HEADER) ?? ""),
    },
  };
}
