const DEFAULT_CHANNEL_WEB_API_TIMEOUT_MS = 30_000;

class ChannelWebApiTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;

  constructor(input: { label: string; timeoutMs: number }) {
    super(`${input.label} timed out after ${input.timeoutMs}ms.`);
    this.label = input.label;
    this.name = "ChannelWebApiTimeoutError";
    this.timeoutMs = input.timeoutMs;
  }
}

export interface ChannelWebApiFetchInput {
  init?: RequestInit;
  label: string;
  timeoutMs?: number | undefined;
  url: RequestInfo | URL;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function fetchChannelWebApi(input: ChannelWebApiFetchInput): Promise<Response> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_CHANNEL_WEB_API_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input.url, {
      ...input.init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new ChannelWebApiTimeoutError({
        label: input.label,
        timeoutMs,
      });
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readChannelWebApiJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
