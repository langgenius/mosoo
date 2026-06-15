import type { SessionViewerSocketContext } from "./socket-headers";

export interface ViewerSocketAttachment extends SessionViewerSocketContext {
  role: "viewer";
}

export type SessionSocketAttachment = ViewerSocketAttachment;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isViewerSocketAttachment(value: unknown): value is ViewerSocketAttachment {
  if (!isRecord(value) || value["role"] !== "viewer") {
    return false;
  }

  const { viewer } = value;

  return (
    typeof value["publicOrigin"] === "string" &&
    typeof value["appId"] === "string" &&
    typeof value["sessionId"] === "string" &&
    isRecord(viewer) &&
    typeof viewer["email"] === "string" &&
    typeof viewer["emailVerified"] === "boolean" &&
    typeof viewer["id"] === "string" &&
    (typeof viewer["imageUrl"] === "string" || viewer["imageUrl"] === null) &&
    typeof viewer["name"] === "string"
  );
}
