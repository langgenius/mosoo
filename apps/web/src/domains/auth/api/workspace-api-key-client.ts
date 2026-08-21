import type {
  CreateWorkspaceApiKeyResponse,
  WorkspaceApiKeyListResponse,
  WorkspaceApiKeySummary,
} from "@mosoo/contracts/auth";
import type { AppId, WorkspaceApiKeyId } from "@mosoo/contracts/id";

import { apiFetch } from "@/platform/http/public-api";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readErrorMessage(value: unknown): string | null {
  return isJsonObject(value) && typeof value["error"] === "string" ? value["error"] : null;
}

function parseSummary(value: unknown): WorkspaceApiKeySummary {
  if (!isJsonObject(value)) {
    throw new Error("Invalid Workspace API key response.");
  }

  const { createdAt, id, label, lastUsedAt, revokedAt, workspaceId } = value;
  if (
    typeof createdAt !== "string" ||
    typeof id !== "string" ||
    typeof label !== "string" ||
    (lastUsedAt !== null && typeof lastUsedAt !== "string") ||
    (revokedAt !== null && typeof revokedAt !== "string") ||
    typeof workspaceId !== "string"
  ) {
    throw new Error("Invalid Workspace API key response.");
  }

  return {
    createdAt,
    id: id as WorkspaceApiKeyId,
    label,
    lastUsedAt,
    revokedAt,
    workspaceId: workspaceId as AppId,
  };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function readResponse<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  const payload = await readJson(response).catch(() => null);
  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? `${response.status} ${response.statusText}`);
  }
  return parse(payload);
}

export async function listWorkspaceApiKeys(
  workspaceId: AppId,
): Promise<WorkspaceApiKeyListResponse> {
  const response = await apiFetch(`/workspaces/${workspaceId}/api-keys`, {
    credentials: "include",
  });

  return readResponse(response, (value) => {
    if (!isJsonObject(value) || !Array.isArray(value["keys"])) {
      throw new Error("Invalid Workspace API key list response.");
    }
    return { keys: value["keys"].map(parseSummary) };
  });
}

export async function createWorkspaceApiKey(
  workspaceId: AppId,
  label: string,
): Promise<CreateWorkspaceApiKeyResponse> {
  const response = await apiFetch(`/workspaces/${workspaceId}/api-keys`, {
    body: JSON.stringify({ label }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return readResponse(response, (value) => {
    if (!isJsonObject(value) || typeof value["value"] !== "string") {
      throw new Error("Invalid Workspace API key create response.");
    }
    return { key: parseSummary(value["key"]), value: value["value"] };
  });
}

export async function revokeWorkspaceApiKey(
  workspaceId: AppId,
  keyId: WorkspaceApiKeyId,
): Promise<void> {
  const response = await apiFetch(`/workspaces/${workspaceId}/api-keys/${keyId}`, {
    credentials: "include",
    method: "DELETE",
  });

  await readResponse(response, (value) => {
    if (!isJsonObject(value) || value["ok"] !== true) {
      throw new Error("Invalid Workspace API key revoke response.");
    }
  });
}
