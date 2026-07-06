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
