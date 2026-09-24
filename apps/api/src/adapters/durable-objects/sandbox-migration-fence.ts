export const SANDBOX_MIGRATION_FENCE_STORAGE_KEY = "mosooSandboxMigrationFenceV1";

export interface SandboxMigrationFenceClaim {
  readonly operationId: string;
  readonly revision: number;
}

interface FenceOwner {
  readonly operationId: string;
  readonly bootId: string;
}

interface FenceRecord {
  readonly revision: number;
  readonly active: FenceOwner | null;
  readonly releasedOperationId: string | null;
}

interface FenceContext {
  readonly storage: {
    get(key: string): Promise<unknown>;
    put(key: string, value: unknown): Promise<void>;
    sync(): Promise<void>;
  };
  readonly container?: {
    readonly running: boolean;
    monitor(): Promise<void>;
    destroy(): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  abort(reason?: string): void;
}

function parseRecord(value: unknown): FenceRecord {
  if (value === undefined) return { revision: 0, active: null, releasedOperationId: null };
  if (
    typeof value !== "object" ||
    value === null ||
    !("revision" in value) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !("releasedOperationId" in value) ||
    (value.releasedOperationId !== null && typeof value.releasedOperationId !== "string") ||
    !("active" in value)
  )
    throw new Error("Invalid persisted Sandbox migration fence.");
  const active = value.active;
  let owner: FenceOwner | null = null;
  if (active !== null) {
    if (
      typeof active !== "object" ||
      !("operationId" in active) ||
      typeof active.operationId !== "string" ||
      !active.operationId ||
      !("bootId" in active) ||
      typeof active.bootId !== "string" ||
      !active.bootId
    )
      throw new Error("Invalid persisted Sandbox migration fence owner.");
    owner = { operationId: active.operationId, bootId: active.bootId };
  }
  return {
    revision: value.revision,
    active: owner,
    releasedOperationId: value.releasedOperationId,
  };
}

function validateClaim(claim: SandboxMigrationFenceClaim): void {
  if (
    !claim ||
    typeof claim.operationId !== "string" ||
    !claim.operationId ||
    !Number.isSafeInteger(claim.revision) ||
    claim.revision < 0
  )
    throw new Error("Invalid Sandbox migration fence claim.");
}

/** Physical exclusion only; the caller must first protect idle D1 resources. */
export class SandboxMigrationFence {
  readonly #bootId = crypto.randomUUID();
  #record?: FenceRecord;
  #loading?: Promise<FenceRecord>;
  #stopping: Promise<void> | undefined;
  #stopped = false;
  readonly ctx: FenceContext;

  constructor(ctx: FenceContext) {
    this.ctx = ctx;
  }

  async #read(): Promise<FenceRecord> {
    if (this.#record) return this.#record;
    this.#loading ??= this.ctx.storage.get(SANDBOX_MIGRATION_FENCE_STORAGE_KEY).then(parseRecord);
    this.#record ??= await this.#loading;
    return this.#record;
  }

  async inspect() {
    const record = await this.#read();
    return {
      revision: record.revision,
      operationId: record.active?.operationId ?? null,
      resetRequired: record.active?.bootId === this.#bootId,
      stopping: this.#stopping !== undefined,
      stoppedVerified: record.active !== null && this.#stopped,
    };
  }

  async assertOpen(): Promise<void> {
    if ((await this.#read()).active) throw new Error("Sandbox migration fence is held.");
  }

  async #serialize<T>(action: () => Promise<T>): Promise<T> {
    // Throwing inside blockConcurrencyWhile resets the actor. Ordinary stale
    // claims must fail without interrupting a later, healthy SDK execution.
    const result = await this.ctx.blockConcurrencyWhile(async () => {
      try {
        return { ok: true as const, value: await action() };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    if (!result.ok) throw result.error;
    return result.value;
  }

  async begin(claim: SandboxMigrationFenceClaim) {
    validateClaim(claim);
    return this.#serialize(async () => {
      const record = await this.#read();
      if (record.revision !== claim.revision || record.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Stale Sandbox migration fence revision.");
      }
      if (record.active && record.active.operationId !== claim.operationId) {
        throw new Error("Sandbox migration fence belongs to another operation.");
      }
      if (record.active && record.active.bootId !== this.#bootId) return this.inspect();
      this.#stopped = false;
      this.#record = {
        ...record,
        active: { operationId: claim.operationId, bootId: this.#bootId },
      };
      await this.ctx.storage.put(SANDBOX_MIGRATION_FENCE_STORAGE_KEY, this.#record);
      // put() may only acknowledge the write buffer. The marker must survive
      // abort(), which cancels old SDK callbacks, streams and JS continuations.
      await this.ctx.storage.sync();
      this.ctx.abort("Sandbox migration fence acquired; reacquire the Durable Object stub.");
      throw new Error("Sandbox migration fence reset unexpectedly returned.");
    });
  }

  async #owned(claim: SandboxMigrationFenceClaim): Promise<FenceRecord> {
    validateClaim(claim);
    const record = await this.#read();
    if (record.revision !== claim.revision || record.active?.operationId !== claim.operationId) {
      throw new Error("Sandbox migration fence belongs to another operation or revision.");
    }
    if (record.active.bootId === this.#bootId)
      throw new Error("Sandbox migration fence still requires an actor reset.");
    return record;
  }

  async stop(claim: SandboxMigrationFenceClaim) {
    await this.#owned(claim);
    if (!this.#stopping) {
      this.#stopped = false;
      const stopping = this.#stopContainer()
        .then(() => {
          this.#stopped = true;
        })
        .finally(() => {
          if (this.#stopping === stopping) this.#stopping = undefined;
        });
      this.#stopping = stopping;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#stopping,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Timed out stopping fenced Sandbox.")),
            25_000,
          );
        }),
      ]);
    } finally {
      // A caller timeout must not release a still-pending destroy/monitor.
      clearTimeout(timeout);
    }
    await this.#owned(claim);
    return this.inspect();
  }

  async #stopContainer(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error("Sandbox physical container state is unavailable.");
    if (!container.running) return;
    // SIGKILL is reported as a rejected monitor (e.g. exit 137). Observe either
    // outcome, then independently require the physical running bit to be false.
    const exited = container.monitor().then(
      () => undefined,
      () => undefined,
    );
    await container.destroy();
    await exited;
    if (container.running) throw new Error("Fenced Sandbox has not physically stopped.");
  }

  async release(claim: SandboxMigrationFenceClaim) {
    validateClaim(claim);
    return this.#serialize(async () => {
      const current = await this.#read();
      if (
        !current.active &&
        current.revision === claim.revision + 1 &&
        current.releasedOperationId === claim.operationId
      ) {
        return this.inspect();
      }
      const record = await this.#owned(claim);
      if (!this.#stopped || this.#stopping || this.ctx.container?.running !== false) {
        throw new Error("Sandbox migration fence cannot release before physical stop completes.");
      }
      const released = {
        revision: record.revision + 1,
        active: null,
        releasedOperationId: claim.operationId,
      };
      await this.ctx.storage.put(SANDBOX_MIGRATION_FENCE_STORAGE_KEY, released);
      await this.ctx.storage.sync();
      this.#record = released;
      return this.inspect();
    });
  }
}
