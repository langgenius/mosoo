export const DRIVER_SOCKET_MISSING_MESSAGE = "Runtime driver control socket is not connected.";

export function isDriverControlSocketMissingError(error: unknown): boolean {
  return error instanceof Error && error.message === DRIVER_SOCKET_MISSING_MESSAGE;
}
