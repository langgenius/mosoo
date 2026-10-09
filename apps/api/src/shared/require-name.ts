import { validationError } from "../platform/errors";

export function requireName(name: string, label: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw validationError(`${label} is required.`);
  }

  return normalized;
}
