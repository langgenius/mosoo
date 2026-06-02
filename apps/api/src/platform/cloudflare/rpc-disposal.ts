interface SyncDisposable {
  [Symbol.dispose](): void;
}

export function disposeRpcResource(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }

  const dispose = (value as Partial<SyncDisposable>)[Symbol.dispose];

  if (typeof dispose === "function") {
    dispose.call(value);
  }
}

export async function withDisposedRpcResource<T, R>(
  resource: T,
  operation: (resource: T) => Promise<R> | R,
): Promise<R> {
  try {
    return await operation(resource);
  } finally {
    disposeRpcResource(resource);
  }
}

export async function withDisposedRpcResult<T, R>(
  resource: Promise<T> | T,
  operation: (resource: T) => Promise<R> | R,
): Promise<R> {
  return withDisposedRpcResource(await resource, operation);
}
