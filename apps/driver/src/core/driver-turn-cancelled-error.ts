export class DriverTurnCancelledError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "DriverTurnCancelledError";
  }
}

export function isDriverTurnCancelledError(error: unknown): error is DriverTurnCancelledError {
  return error instanceof DriverTurnCancelledError;
}
