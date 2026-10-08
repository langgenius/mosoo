function guardReturnedHandles(value: unknown, assertCurrent: () => void): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => guardReturnedHandles(entry, assertCurrent));
  }
  if (typeof value !== "object" || value === null) return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  // SDK Session/Process handles are plain records. Keep dates, streams and
  // platform resources intact; this guard does not drain their pending work.
  if (prototype !== Object.prototype && prototype !== null) return value;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
    if (!("value" in descriptor)) continue;
    const member: unknown = descriptor.value;
    descriptor.value =
      typeof member === "function"
        ? async (...args: unknown[]) => {
            assertCurrent();
            return guardReturnedHandles(await Reflect.apply(member, value, args), assertCurrent);
          }
        : guardReturnedHandles(member, assertCurrent);
  }
  return Object.defineProperties(Object.create(prototype), descriptors);
}

/** Revokes returned SDK callbacks across explicit destroy calls, not all I/O. */
export class SandboxHandleGuard {
  #generation = 0;
  #destroying = 0;

  async capture(action: () => Promise<unknown>): Promise<unknown> {
    const generation = this.#generation;
    return guardReturnedHandles(await action(), () => {
      if (this.#destroying !== 0 || generation !== this.#generation) {
        throw new Error("Sandbox handle was invalidated by container teardown.");
      }
    });
  }

  async destroy(action: () => Promise<unknown>): Promise<unknown> {
    this.#generation++;
    this.#destroying++;
    try {
      return await action();
    } finally {
      // Also invalidate handles obtained while destruction was pending, even
      // when teardown failed or another coalesced destroy is still finishing.
      this.#generation++;
      this.#destroying--;
    }
  }
}
