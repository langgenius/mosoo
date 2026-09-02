import type { SessionViewerSocketContext } from "./socket-headers";

export interface ViewerSocketAttachment extends SessionViewerSocketContext {
  role: "viewer";
  runtimeEventSeqCursor?: number;
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
    typeof value["projectId"] === "string" &&
    typeof value["sessionId"] === "string" &&
    (value["runtimeEventSeqCursor"] === undefined ||
      (typeof value["runtimeEventSeqCursor"] === "number" &&
        Number.isSafeInteger(value["runtimeEventSeqCursor"]) &&
        value["runtimeEventSeqCursor"] >= 0)) &&
    isRecord(viewer) &&
    typeof viewer["email"] === "string" &&
    typeof viewer["emailVerified"] === "boolean" &&
    typeof viewer["id"] === "string" &&
    (typeof viewer["imageUrl"] === "string" || viewer["imageUrl"] === null) &&
    typeof viewer["name"] === "string"
  );
}

export function normalizeViewerSocketAttachment(value: unknown): ViewerSocketAttachment | null {
  if (isViewerSocketAttachment(value)) {
    return value;
  }

  if (!isRecord(value) || typeof value["appId"] !== "string") {
    return null;
  }

  // Durable Objects persist hibernating socket attachments across releases.
  // Normalize the pre-Project shape when an older socket wakes up.
  const normalized: unknown = { ...value, projectId: value["appId"] };
  return isViewerSocketAttachment(normalized) ? normalized : null;
}
