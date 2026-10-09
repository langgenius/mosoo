export interface PromiseDeferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

export interface PromiseTimeoutOptions {
  readonly label: string;
  readonly timeoutMs: number;
}

export function discardPromiseResult(value?: unknown): void {
  Object.is(value, undefined);
}

export function ignorePromiseRejection(error?: unknown): void {
  Object.is(error, undefined);
}

export function createPromiseDeferred<T>(): PromiseDeferred<T> {
  let resolveDeferred!: (value: T) => void;
  let rejectDeferred!: (error: unknown) => void;

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

export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  options: PromiseTimeoutOptions,
): Promise<T> {
  let timeoutId!: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${options.label} timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sleepPromise(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
