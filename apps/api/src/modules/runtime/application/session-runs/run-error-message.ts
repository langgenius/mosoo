import type { RunError } from "@mosoo/contracts/session-run";

import { findRuntimeSubjectCapacityError } from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-errors";

export function describeRunError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const messages: string[] = [];
  const seen = new Set<Error>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);

    if (current.message.trim().length > 0) {
      messages.push(current.message);
    }

    current = current.cause;
  }

  if (messages.length === 0) {
    return fallback;
  }

  return messages.join("; caused by: ");
}

export function toProvisionRunError(error: unknown): RunError {
  const capacityError = findRuntimeSubjectCapacityError(error);

  // A full deployment or account is temporary: say so and let the caller resend.
  if (capacityError !== null) {
    return {
      code: "runtime.capacity_exhausted",
      details: { limit: capacityError.limit, scope: capacityError.scope },
      message: capacityError.message,
      retryable: true,
    };
  }

  return {
    code: "runtime.provision_failed",
    details: {},
    message: describeRunError(error, "Session run provisioning failed."),
    retryable: false,
  };
}
