const MAX_PRESENTABLE_LENGTH = 200;

// Only surface a backend message when it reads as a user-facing sentence. Raw
// internal failures (e.g. a leaked "Failed query: insert into ..." SQL dump with
// params) are long / multi-line — fall back to a concise message instead.
function isPresentableMessage(message: string): boolean {
  return (
    message.length > 0 &&
    message.length <= MAX_PRESENTABLE_LENGTH &&
    !message.includes("\n") &&
    !message.includes("Failed query") &&
    !message.includes("D1_ERROR")
  );
}

export function getErrorMessage(error: unknown, defaultMessage: string): string {
  if (error instanceof Error && isPresentableMessage(error.message)) {
    return error.message;
  }

  return defaultMessage;
}
