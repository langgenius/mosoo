import type { CreateWorkspaceRunRequest, WorkspaceRunResponse } from "@mosoo/contracts/harness";

import { apiFetch } from "@/platform/http/public-api";

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!isJsonObject(payload)) {
    return fallback;
  }

  const error = payload["error"];
  if (typeof error === "string") {
    return error;
  }

  return isJsonObject(error) && typeof error["message"] === "string" ? error["message"] : fallback;
}

export async function createWorkspaceRun(
  apiKey: string,
  input: CreateWorkspaceRunRequest,
): Promise<WorkspaceRunResponse> {
  const response = await apiFetch("/v1/runs", {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `${response.status} ${response.statusText}`));
  }

  if (
    !isJsonObject(payload) ||
    typeof payload["id"] !== "string" ||
    typeof payload["threadId"] !== "string"
  ) {
    throw new Error("Invalid Run response.");
  }

  return payload as unknown as WorkspaceRunResponse;
}
