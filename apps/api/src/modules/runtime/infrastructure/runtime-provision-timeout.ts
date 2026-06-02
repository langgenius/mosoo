import { promiseWithTimeout } from "@mosoo/effects";

const DEFAULT_RUNTIME_PROVISION_TIMEOUT_MS = 15_000;

export async function withRuntimeProvisionTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = DEFAULT_RUNTIME_PROVISION_TIMEOUT_MS,
): Promise<T> {
  return promiseWithTimeout(promise, {
    label,
    timeoutMs,
  });
}
