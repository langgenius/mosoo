import { isTruthy } from "../../shared/truthiness";

interface DurableObjectIdentityOptions {
  mismatchMessage: string;
  requiredMessage: string;
}

export class DurableObjectIdentity {
  #value: string | null = null;
  readonly #mismatchMessage: string;
  readonly #requiredMessage: string;

  constructor(options: DurableObjectIdentityOptions) {
    this.#mismatchMessage = options.mismatchMessage;
    this.#requiredMessage = options.requiredMessage;
  }

  get value(): string | null {
    return this.#value;
  }

  clear(): void {
    this.#value = null;
  }

  ensure(candidate: string | null): string {
    const normalized = normalizeRequiredObjectId(candidate, this.#requiredMessage);

    if (this.#value !== null && normalized !== this.#value) {
      throw new Error(this.#mismatchMessage);
    }

    this.#value = normalized;
    return normalized;
  }

  remember(candidate: string | null): void {
    const normalized = candidate?.trim();

    if (!isTruthy(normalized)) {
      return;
    }

    if (this.#value !== null && normalized !== this.#value) {
      throw new Error(this.#mismatchMessage);
    }

    this.#value = normalized;
  }
}

export function closeOpenSocket(socket: WebSocket, code: number, reason: string): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.close(code, reason);
  }
}

export function sendFrames(socket: WebSocket, frames: string[]): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  for (const frame of frames) {
    socket.send(frame);
  }
}

function normalizeRequiredObjectId(candidate: string | null, requiredMessage: string): string {
  const normalized = candidate?.trim();

  if (!isTruthy(normalized)) {
    throw new Error(requiredMessage);
  }

  return normalized;
}
