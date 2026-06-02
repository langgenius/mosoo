import { parseFileApiError } from "@/shared/lib/file-api-error";

import { apiFetch } from "./public-api";
import type { ApiPath } from "./public-api";

interface JsonRequestInit<TBody extends object | undefined = undefined> extends RequestInit {
  bodyJson?: TBody;
}

export async function requestJson<TResponse, TBody extends object | undefined = undefined>(
  path: ApiPath,
  init?: JsonRequestInit<TBody>,
): Promise<TResponse> {
  const headers = new Headers(init?.headers);

  if (init?.bodyJson !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const requestInit: RequestInit = {
    credentials: "include",
    headers,
    method: init?.method ?? "GET",
  };

  if (init?.bodyJson !== undefined) {
    requestInit.body = JSON.stringify(init.bodyJson);
  } else if (init?.body !== undefined) {
    requestInit.body = init.body;
  }

  const response = await apiFetch(path, requestInit);

  if (!response.ok) {
    throw await parseFileApiError(response);
  }

  const payload: unknown = await response.json();
  return payload as TResponse;
}
