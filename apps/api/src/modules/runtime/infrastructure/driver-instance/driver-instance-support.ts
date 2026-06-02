import { createPromiseDeferred, promiseWithTimeout } from "@mosoo/effects";
import type { PromiseDeferred } from "@mosoo/effects";

export type Deferred<T> = PromiseDeferred<T>;

export function createDeferred<T>(): Deferred<T> {
  return createPromiseDeferred<T>();
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return promiseWithTimeout(promise, {
    label,
    timeoutMs,
  });
}

export function toErrorMessage(error: unknown, defaultMessage = "Unknown error."): string {
  return error instanceof Error ? error.message : defaultMessage;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function readPositiveTimeout(url: URL, label: string): number {
  const raw = Number(url.searchParams.get("timeoutMs") ?? "0");

  if (!Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Timeout for ${label} must be a positive number.`);
  }

  return raw;
}

export function currentTimestampPlus(deltaMs: number): number {
  return Date.now() + deltaMs;
}
