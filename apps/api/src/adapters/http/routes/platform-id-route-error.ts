const PLATFORM_ID_PARSE_ERROR_FRAGMENTS = [
  "must be a ULID string",
  "must be a valid ULID",
] as const;

export function platformIdRouteErrorMessage(error: unknown): string | null {
  if (!(error instanceof TypeError)) {
    return null;
  }

  return PLATFORM_ID_PARSE_ERROR_FRAGMENTS.some((fragment) => error.message.includes(fragment))
    ? error.message
    : null;
}
