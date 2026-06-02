import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";

export const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object.");
  }

  return parsed;
}

export function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}
