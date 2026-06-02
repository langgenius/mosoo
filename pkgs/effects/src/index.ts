interface AsyncTimeoutErrorOptions {
  readonly label: string;
  readonly message: string;
  readonly timeoutMs: number;
}

export class AsyncTimeoutError extends Error {
  readonly _tag = "AsyncTimeoutError";
  readonly label: string;
  readonly timeoutMs: number;

  constructor(options: AsyncTimeoutErrorOptions) {
    super(options.message);
    this.name = "AsyncTimeoutError";
    this.label = options.label;
    this.timeoutMs = options.timeoutMs;
  }
}

export interface PromiseDeferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

export interface PromiseTimeoutOptions {
  readonly label: string;
  readonly timeoutMs: number;
}

export type PromiseTimeoutResult<T> =
  | {
      readonly status: "completed";
      readonly value: T;
    }
  | {
      readonly error: AsyncTimeoutError;
      readonly status: "timed_out";
    }
  | {
      readonly error: unknown;
      readonly status: "failed";
    };

export async function firstSettledPromise<T>(promises: readonly Promise<T>[]): Promise<T> {
  if (promises.length === 0) {
    throw new Error("firstSettledPromise requires at least one promise.");
  }

  return Promise.race(promises);
}

export function discardPromiseResult(value?: unknown): void {
  Object.is(value, undefined);
}

export function ignorePromiseRejection(error?: unknown): void {
  Object.is(error, undefined);
}

function enforceFiniteNonNegativeMilliseconds(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative millisecond value.`);
  }
}

function createUninitializedDeferredCallback(label: string): () => never {
  return () => {
    throw new Error(`Promise deferred ${label} callback was not initialized.`);
  };
}

export function createPromiseDeferred<T>(): PromiseDeferred<T> {
  let resolveDeferred: (value: T) => void = createUninitializedDeferredCallback("resolve");
  let rejectDeferred: (error: unknown) => void = createUninitializedDeferredCallback("reject");

  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

export function createTimeoutError(options: PromiseTimeoutOptions): AsyncTimeoutError {
  return new AsyncTimeoutError({
    label: options.label,
    message: `${options.label} timed out after ${options.timeoutMs}ms.`,
    timeoutMs: options.timeoutMs,
  });
}

export function isAsyncTimeoutError(error: unknown): error is AsyncTimeoutError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error["_tag"] === "AsyncTimeoutError"
  );
}

export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  options: PromiseTimeoutOptions,
): Promise<T> {
  enforceFiniteNonNegativeMilliseconds(options.timeoutMs, options.label);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(createTimeoutError(options));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function settlePromiseWithTimeout<T>(
  promise: Promise<T>,
  options: PromiseTimeoutOptions,
): Promise<PromiseTimeoutResult<T>> {
  try {
    return {
      status: "completed",
      value: await promiseWithTimeout(promise, options),
    };
  } catch (error) {
    if (isAsyncTimeoutError(error)) {
      return {
        error,
        status: "timed_out",
      };
    }

    return {
      error,
      status: "failed",
    };
  }
}

export async function sleepPromise(ms: number): Promise<void> {
  enforceFiniteNonNegativeMilliseconds(ms, "sleep");

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
