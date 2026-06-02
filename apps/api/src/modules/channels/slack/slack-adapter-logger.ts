import { logChannelAdapterError } from "../application/channel-adapter-logger";

export function logSlackAdapterError(
  message: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  logChannelAdapterError(message, error, context);
}
