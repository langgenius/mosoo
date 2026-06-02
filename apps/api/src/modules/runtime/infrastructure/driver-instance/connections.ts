export const EVENT_BATCH_MAX_SIZE = 64;
export const LOG_BATCH_MAX_SIZE = 64;

function isDriverInstanceBadRequestMessage(message: string): boolean {
  return (
    message === "Driver instance id is required." ||
    message.startsWith("Event batch exceeds max size ") ||
    message.startsWith("Log batch exceeds max size ")
  );
}

function isDriverInstanceConflictMessage(message: string): boolean {
  return (
    message === "Driver hello has already been received." ||
    message === "Driver hello is required before heartbeat." ||
    message === "Driver hello is required before pushEvents." ||
    message === "Driver hello is required before pushLogs." ||
    message === "Driver instance id does not match the active Durable Object." ||
    message === "Driver instance id mismatch." ||
    message.includes("already closed.") ||
    message.includes("closed before hello.")
  );
}

export function toDriverInstanceRequestErrorStatus(message: string): number {
  if (message.includes("timed out after")) {
    return 408;
  }

  if (isDriverInstanceBadRequestMessage(message)) {
    return 400;
  }

  if (isDriverInstanceConflictMessage(message)) {
    return 409;
  }

  return 500;
}
