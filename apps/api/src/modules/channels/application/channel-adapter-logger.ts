type ChannelAdapterLogContext = Record<string, unknown>;

function serializeError(error: unknown): ChannelAdapterLogContext {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export function logChannelAdapterError(
  message: string,
  error: unknown,
  context: ChannelAdapterLogContext = {},
): void {
  globalThis.reportError(
    new Error(
      JSON.stringify({
        ...context,
        error: serializeError(error),
        message,
      }),
    ),
  );
}
