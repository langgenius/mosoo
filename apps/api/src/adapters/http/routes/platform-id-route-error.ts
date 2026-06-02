const PLATFORM_ID_PARSE_ERROR_FRAGMENTS = [
  "must be a ULID string",
  "must be a valid ULID",
  "must be a canonical ULID",
] as const;

export function platformIdRouteErrorMessage(error: unknown): string | null {
  if (!(error instanceof TypeError)) {
    return null;
  }

  return PLATFORM_ID_PARSE_ERROR_FRAGMENTS.some((fragment) => error.message.includes(fragment))
    ? error.message
    : null;
}

export function platformIdRouteErrorResponse(
  error: unknown,
  body: (message: string) => Record<string, unknown>,
): Response | null {
  const message = platformIdRouteErrorMessage(error);

  if (message === null) {
    return null;
  }

  return Response.json(body(message), { status: 400 });
}
