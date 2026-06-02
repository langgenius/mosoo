import { PUBLIC_API_PREFIX } from "@mosoo/contracts/public-api";

export type ApiPath = `/${string}`;

export function apiPath(path: ApiPath): string {
  return `${PUBLIC_API_PREFIX}${path}`;
}

export async function apiFetch(path: ApiPath, init?: RequestInit): Promise<Response> {
  return fetch(apiPath(path), init);
}
