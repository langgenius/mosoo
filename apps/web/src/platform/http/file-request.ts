import type { FileErrorResponse } from "@mosoo/contracts/file";

import { apiFetch } from "./public-api";
import type { ApiPath } from "./public-api";

// File routes answer `{ error: { message } }`, auth routes `{ error: string }`
// and Better Auth `{ message: string }`; anything else falls back to the status line.
export async function readFileApiError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string | Partial<FileErrorResponse["error"]>;
    message?: unknown;
  } | null;
  const message =
    typeof payload?.error === "string"
      ? payload.error
      : (payload?.error?.message ?? payload?.message);

  return new Error(
    typeof message === "string" ? message : `${response.status} ${response.statusText}`,
  );
}

export async function requestJson<TResponse>(
  path: ApiPath,
  init: { bodyJson?: object; method?: "DELETE" | "GET" | "POST" } = {},
): Promise<TResponse> {
  const response = await apiFetch(path, {
    credentials: "include",
    method: init.method ?? "GET",
    ...(init.bodyJson === undefined
      ? {}
      : { body: JSON.stringify(init.bodyJson), headers: { "Content-Type": "application/json" } }),
  });

  if (!response.ok) {
    throw await readFileApiError(response);
  }

  return (await response.json()) as TResponse;
}
