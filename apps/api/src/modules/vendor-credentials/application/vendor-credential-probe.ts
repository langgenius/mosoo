import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import type { ProviderFetchProxyConfig } from "./provider-fetch-proxy";
import { fetchViaProviderProxy } from "./provider-fetch-proxy";

export function toVendorProbeEndpointUrl(
  apiBase: string,
  suffix: "chat/completions" | "models",
): string {
  const trimmed = apiBase.replace(/\/+$/u, "");

  try {
    const url = new URL(trimmed);
    const hasPathBase = url.pathname.replace(/\/+$/u, "").length > 0;

    return hasPathBase ? `${trimmed}/${suffix}` : `${trimmed}/v1/${suffix}`;
  } catch {
    return trimmed.endsWith("/v1") ? `${trimmed}/${suffix}` : `${trimmed}/v1/${suffix}`;
  }
}

export function toVendorProbeAuthHeaders(
  vendor: RuntimeCatalogVendor,
  apiKey: string,
): Record<string, string> {
  switch (vendor.authHeader.scheme) {
    case "api-key": {
      return {
        ...vendor.authHeader.extraHeaders,
        [vendor.authHeader.apiKeyHeader]: apiKey,
      };
    }
    case "bearer": {
      return { [vendor.authHeader.apiKeyHeader]: `Bearer ${apiKey}` };
    }
  }
}

export async function fetchVendorProbe(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchProxy: ProviderFetchProxyConfig | null,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    if (fetchProxy) {
      return await fetchViaProviderProxy(url, init, timeoutMs, fetchProxy, controller.signal);
    }

    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function toVendorProbeErrorCode(status: number, detail?: string | null): string {
  const baseCode = `http_${status}`;
  const safeDetail = sanitizeProviderErrorDetail(detail);
  return safeDetail !== undefined && safeDetail.length > 0
    ? `${baseCode}: ${safeDetail}`
    : baseCode;
}

function sanitizeProviderErrorDetail(detail: string | null | undefined): string | undefined {
  const normalized = detail
    ?.trim()
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer ***")
    .replaceAll(/\b(sk|rk|pk)-[A-Za-z0-9_*.-]+/gu, "$1-***");

  return normalized === undefined ? undefined : normalized.slice(0, 180);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecordString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readProviderErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const directMessage = readRecordString(payload, "message") ?? readRecordString(payload, "error");

  if (directMessage !== null && directMessage.length > 0) {
    return directMessage;
  }

  const nestedError = payload["error"];

  if (isRecord(nestedError)) {
    return readRecordString(nestedError, "message");
  }

  return null;
}

export async function readVendorProbeErrorCode(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const payload: unknown = await response.json();
      return toVendorProbeErrorCode(response.status, readProviderErrorMessage(payload));
    }

    const body = await response.text();
    const detail = body.trim();
    const safeDetail = detail === "{}" || detail === "[]" ? response.statusText : detail;
    return toVendorProbeErrorCode(
      response.status,
      safeDetail.length > 0 ? safeDetail : response.statusText,
    );
  } catch {
    return toVendorProbeErrorCode(response.status, response.statusText);
  }
}

export function readVendorProbeBaseHost(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return "";
  }
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));

  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) || octet < 0 || octet > 255 || parts[index] !== String(octet),
    )
  ) {
    return null;
  }

  const first = octets[0];
  const second = octets[1];
  const third = octets[2];
  const fourth = octets[3];

  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    return null;
  }

  return [first, second, third, fourth];
}

function isBlockedIpv4([first, second]: readonly [number, number, number, number]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isBlockedProbeHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
    .replace(/\.+$/u, "");
  const isIpv6 = normalized.includes(":");

  if (
    normalized.length === 0 ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    (isIpv6 &&
      (normalized === "::1" ||
        normalized === "::" ||
        normalized.startsWith("::ffff:") ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:")))
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);

  if (ipv4 === null) {
    return false;
  }

  return isBlockedIpv4(ipv4);
}

export function validateVendorProbeBaseUrl(baseUrl: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    return "invalid_api_base";
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.hostname.length === 0) {
    return "invalid_api_base";
  }

  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    isBlockedProbeHostname(parsed.hostname)
  ) {
    return "blocked_api_base";
  }

  if (parsed.protocol !== "https:") {
    return "insecure_api_base";
  }

  return null;
}

export function vendorProbeModelListIncludes(payload: unknown, modelId: string): boolean {
  const data = Array.isArray(payload)
    ? payload
    : isRecord(payload) && "data" in payload
      ? payload["data"]
      : payload;

  if (!Array.isArray(data)) {
    return false;
  }

  return data.some((entry) => {
    if (typeof entry === "string") {
      return entry === modelId;
    }

    if (!isRecord(entry)) {
      return false;
    }

    return entry["id"] === modelId;
  });
}
