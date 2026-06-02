export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function toErrorMessage(error: unknown, defaultMessage = "Session request failed."): string {
  return error instanceof Error ? error.message : defaultMessage;
}
