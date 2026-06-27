import type { CliOAuthDeviceConfirmResponse } from "@mosoo/contracts/auth";

import { apiFetch } from "@/platform/http/public-api";

export async function confirmCliOAuthDeviceFlow(
  userCode: string,
): Promise<CliOAuthDeviceConfirmResponse> {
  const response = await apiFetch("/auth/cli/confirm", {
    body: JSON.stringify({ user_code: userCode }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? "CLI authorization failed.");
  }

  return parseConfirmResponse(payload);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  const error = value["error"];
  if (typeof error === "string") {
    return error;
  }
  if (isRecord(error) && typeof error["message"] === "string") {
    return error["message"];
  }
  return null;
}

function parseConfirmResponse(value: unknown): CliOAuthDeviceConfirmResponse {
  if (
    !isRecord(value) ||
    typeof value["status"] !== "string" ||
    typeof value["user_code"] !== "string"
  ) {
    throw new Error("CLI authorization response is invalid.");
  }

  return {
    status: value["status"] as CliOAuthDeviceConfirmResponse["status"],
    user_code: value["user_code"],
  };
}
