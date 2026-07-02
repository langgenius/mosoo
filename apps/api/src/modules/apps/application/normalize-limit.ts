import { validationError } from "../../../platform/errors";

/**
 * Validate and clamp a caller-supplied page limit: null/undefined falls back
 * to the default, non-positive or non-integer values are rejected, and values
 * over the cap are clamped rather than rejected — the shared semantics for
 * every apps-module list query.
 */
export function normalizeLimit(
  value: number | null | undefined,
  field: string,
  { defaultLimit, maxLimit }: { defaultLimit: number; maxLimit: number },
): number {
  if (value === null || value === undefined) {
    return defaultLimit;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw validationError(`${field} must be a positive integer.`);
  }

  return Math.min(value, maxLimit);
}
