import { describe, expect, mock, spyOn, test } from "bun:test";

import { hashSandboxNetworkConstraints } from "../src/modules/runtime/domain/sandbox-network-constraints";

const FULL_NETWORK_CONSTRAINTS = { allowedHosts: [], networkPolicy: "full" } as const;
const FULL_NETWORK_CONSTRAINTS_HASH = await hashSandboxNetworkConstraints(FULL_NETWORK_CONSTRAINTS);

class SandboxDelegateMock {
  alarmBarrier: Promise<void> | null = null;
  backupCalls = 0;
  backupOptions: unknown[] = [];
  destroyBarrier: Promise<void> | null = null;
  destroyCalls = 0;
  destroyError: Error | null = null;
  enableInternet = true;
  envVars: Record<string, string> = {};
  getPlacementError: Error | null = null;
  interceptHttps = false;
  lastSessionKeys: PropertyKey[] = [];
  mkdirCalls = 0;
  placement: string | null | undefined = "placement-1";
  readonly plainDto = { nested: { value: "unchanged" }, success: true };
  processActionCalls = 0;
  readFileBarrier: Promise<void> | null = null;
  readFileError: Error | null = null;
  startProcessBarrier: Promise<void> | null = null;
  terminalBarrier: Promise<void> | null = null;
  terminalCalls = 0;
  terminalError: Error | null = null;
  streamOpenCalls = 0;
  streamReadCalls = 0;
  writeFileBarrier: Promise<void> | null = null;
  onAlarmStart: (() => void) | null = null;
  onMkdir: (() => void) | null = null;
  onReadFileStart: (() => void) | null = null;
  onStartProcessStart: (() => void) | null = null;
  onTerminalStart: (() => void) | null = null;
  onWriteFileStart: (() => void) | null = null;
  readonly files = new Map<string, string>();

  async alarm(): Promise<void> {
    this.onAlarmStart?.();
    await this.alarmBarrier;
  }

  async createBackup(options: unknown): Promise<{ dir: string; id: string }> {
    this.backupCalls += 1;
    this.backupOptions.push(options);
    return {
      dir: Reflect.get(options as object, "dir") as string,
      id: "550e8400-e29b-41d4-a716-446655440001",
    };
  }

  async createSession(options: { id: string }) {
    void options;
    const session = {
      execStream: () => this.execStream(),
      getProcess: () => this.getProcess(),
      id: "user-session",
      listProcesses: () => this.listProcesses(),
      readFileStream: () => this.readFileStream(),
      readFile: async (path: string) => {
        const content = this.files.get(path);
        if (content === undefined) {
          throw new Error("missing file");
        }
        return { content };
      },
      startProcess: (
        command: string,
        startOptions?: Parameters<SandboxDelegateMock["startProcess"]>[1],
      ) => this.startProcess(command, startOptions),
      streamProcessLogs: () => this.streamProcessLogs(),
      terminal: async () => {
        this.onTerminalStart?.();
        await this.terminalBarrier;
        if (this.terminalError !== null) {
          throw this.terminalError;
        }
        this.terminalCalls += 1;
        return new Response("terminal");
      },
      upstreamOnlyMethod: async () => "preserved",
    };
    this.lastSessionKeys = Reflect.ownKeys(session);
    return session;
  }

  async deleteSession(): Promise<void> {}

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
    await this.destroyBarrier;
    if (this.destroyError !== null) {
      throw this.destroyError;
    }
  }

  async exec(): Promise<typeof this.plainDto> {
    return this.plainDto;
  }

  async exists(path: string) {
    return {
      exists: this.files.has(path),
      path,
      success: true,
      timestamp: new Date(0).toISOString(),
    };
  }

  async execStream(): Promise<ReturnType<SandboxDelegateMock["streamHandle"]>> {
    this.streamOpenCalls += 1;
    return this.streamHandle();
  }

  async getContainerPlacementId(): Promise<string | null | undefined> {
    if (this.getPlacementError !== null) {
      throw this.getPlacementError;
    }
    return this.placement;
  }

  async getProcess(): Promise<ReturnType<SandboxDelegateMock["processHandle"]>> {
    return this.processHandle();
  }

  async getSession(): ReturnType<SandboxDelegateMock["createSession"]> {
    return this.createSession({ id: "user-session" });
  }

  async mkdir(): Promise<void> {
    this.mkdirCalls += 1;
    this.onMkdir?.();
  }

  async listProcesses(): Promise<Array<ReturnType<SandboxDelegateMock["processHandle"]>>> {
    return [this.processHandle()];
  }

  processHandle() {
    const action = async () => {
      this.processActionCalls += 1;
    };
    return {
      command: "driver",
      endTime: undefined,
      exitCode: undefined,
      getLogs: action,
      getStatus: action,
      id: "process-1",
      kill: action,
      pid: 1,
      sessionId: "session-1",
      startTime: new Date(0),
      status: "running",
      waitForExit: action,
      waitForLog: action,
      waitForPort: action,
    };
  }

  async startProcess(
    _command: string,
    options?: { onStart?: (process: ReturnType<SandboxDelegateMock["processHandle"]>) => void },
  ): Promise<ReturnType<SandboxDelegateMock["processHandle"]>> {
    const process = this.processHandle();
    options?.onStart?.(process);
    this.onStartProcessStart?.();
    await this.startProcessBarrier;
    return process;
  }

  streamHandle() {
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: async () => {
        this.streamReadCalls += 1;
        return { done: true as const, value: undefined };
      },
    };
  }

  async readFile(path: string): Promise<{ content: string }> {
    this.onReadFileStart?.();
    await this.readFileBarrier;
    if (this.readFileError !== null) {
      throw this.readFileError;
    }
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error("missing file");
    }
    return { content };
  }

  async readFileStream(): Promise<ReturnType<SandboxDelegateMock["streamHandle"]>> {
    this.streamOpenCalls += 1;
    return this.streamHandle();
  }

  async setAllowedHosts(): Promise<void> {}

  async setKeepAlive(): Promise<void> {}

  async streamProcessLogs(): Promise<ReturnType<SandboxDelegateMock["streamHandle"]>> {
    this.streamOpenCalls += 1;
    return this.streamHandle();
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.onWriteFileStart?.();
    await this.writeFileBarrier;
    this.files.set(path, content);
  }
}

let delegate: SandboxDelegateMock;
let abortCalls = 0;
let abortRetryAlarm = false;
let alarmWrites = 0;

function registerDelegate(value: SandboxDelegateMock): void {
  delegate = value;
}

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      protected readonly ctx: unknown,
      protected readonly env: unknown,
    ) {}
  },
}));

mock.module("@cloudflare/sandbox", () => ({
  Sandbox: class extends SandboxDelegateMock {
    constructor() {
      super();
      registerDelegate(this);
    }
  },
}));

const { Sandbox } = await import("../src/adapters/durable-objects/sandbox.do");

function createBarrier(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function createSandbox(): Sandbox {
  const values = new Map<string, unknown>();
  const ctx = {
    abort: (_reason?: string, options?: { retryAlarm?: boolean }) => {
      abortCalls += 1;
      abortRetryAlarm = options?.retryAlarm === true;
      throw new Error("durable object aborted");
    },
    blockConcurrencyWhile: <T>(action: () => Promise<T>) => action(),
    container: { running: true },
    storage: {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === "string") {
          values.set(key, value);
          return;
        }
        for (const [entryKey, entryValue] of Object.entries(key)) {
          values.set(entryKey, entryValue);
        }
      },
      setAlarm: async () => {
        alarmWrites += 1;
      },
    },
  };
  abortCalls = 0;
  abortRetryAlarm = false;
  alarmWrites = 0;
  return new Sandbox(ctx, { SANDBOX_FILE_BUCKET_LOCAL: "false" });
}

async function createReadySandbox(): Promise<Sandbox> {
  const sandbox = createSandbox();
  await sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);
  await sandbox.markRuntimeSubjectIncarnationReady(4, FULL_NETWORK_CONSTRAINTS_HASH);
  return sandbox;
}

describe("sandbox runtime incarnation health", () => {
  test("fails closed before SDK backup creation when legacy persistent auth exists", async () => {
    const sandbox = await createReadySandbox();
    const authPath = "/workspace/se/session/.state/openai-runtime/auth.json";
    delegate.files.set(authPath, "secret");
    const handle = sandbox as unknown as {
      createRuntimeSubjectBackup(
        incarnation: number,
        options: {
          dir: string;
          excludes: string[];
          forbiddenPaths: string[];
          name: string;
        },
      ): Promise<{ dir: string; id: string }>;
    };
    const options = {
      dir: "/workspace/se/session",
      excludes: [".mosoo-session-files-session"],
      forbiddenPaths: [authPath],
      name: "mosoo:runtime-backup:v1:01J0000000000000000000000B",
    };

    await expect(handle.createRuntimeSubjectBackup(4, options)).rejects.toThrow(
      "legacy persistent credentials",
    );
    expect(delegate.backupCalls).toBe(0);
    expect(delegate.mkdirCalls).toBe(0);

    delegate.files.delete(authPath);
    await expect(handle.createRuntimeSubjectBackup(4, options)).resolves.toEqual({
      dir: options.dir,
      id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(delegate.mkdirCalls).toBe(1);
    expect(delegate.backupCalls).toBe(1);
    expect(delegate.backupOptions).toEqual([
      {
        dir: options.dir,
        excludes: options.excludes,
        name: options.name,
      },
    ]);
  });

  test("keeps incarnation and network policy as one immutable identity", async () => {
    const sandbox = createSandbox();
    await sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);
    await expect(
      sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH),
    ).resolves.toBeUndefined();
    await expect(sandbox.activateRuntimeSubjectIncarnation(4, "0".repeat(64))).rejects.toThrow(
      "identity does not match",
    );
  });

  test("rejects network mutation that differs from the admitted identity", async () => {
    const sandbox = createSandbox();
    await sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);

    await expect(
      sandbox.configureNetworkConstraints({
        allowedHosts: ["example.com"],
        networkPolicy: "limited",
      }),
    ).rejects.toThrow("do not match the admitted incarnation");
  });

  test("keeps a ready incarnation when the placement handshake is unavailable", async () => {
    const sandbox = await createReadySandbox();
    delegate.getPlacementError = new Error("control plane unavailable");

    await expect(
      (sandbox as unknown as { mkdir(path: string): Promise<void> }).mkdir("/workspace"),
    ).rejects.toThrow("health is unknown");
    expect(delegate.destroyCalls).toBe(0);
  });

  test("retires a ready incarnation after a refreshed placement mismatch", async () => {
    const sandbox = await createReadySandbox();
    delegate.placement = "placement-2";

    await expect(
      (sandbox as unknown as { mkdir(path: string): Promise<void> }).mkdir("/workspace"),
    ).rejects.toThrow("replaced or stopped");
    expect(delegate.destroyCalls).toBe(1);
    await expect(
      sandbox.inspectRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH),
    ).resolves.toEqual({
      kind: "retired",
    });
  });

  test("refreshes cached placement before running a business mutation", async () => {
    const sandbox = await createReadySandbox();
    delegate.onReadFileStart = () => {
      delegate.placement = "placement-2";
    };

    await expect(
      (sandbox as unknown as { mkdir(path: string): Promise<void> }).mkdir("/workspace"),
    ).rejects.toThrow("replaced or stopped");
    expect(delegate.mkdirCalls).toBe(0);
    expect(delegate.destroyCalls).toBe(1);
  });

  test("retires when a missing sentinel refreshes the cached placement", async () => {
    const sandbox = await createReadySandbox();
    delegate.onReadFileStart = () => {
      delegate.files.delete("/tmp/.mosoo-runtime-subject-incarnation");
      delegate.placement = "placement-2";
    };

    await expect(
      (sandbox as unknown as { mkdir(path: string): Promise<void> }).mkdir("/workspace"),
    ).rejects.toThrow("replaced or stopped");
    expect(delegate.mkdirCalls).toBe(0);
    expect(delegate.destroyCalls).toBe(1);
  });

  test("retires a structured missing sentinel without placement ids", async () => {
    const sandbox = createSandbox();
    await sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);
    delegate.placement = null;
    await sandbox.markRuntimeSubjectIncarnationReady(4, FULL_NETWORK_CONSTRAINTS_HASH);
    delegate.readFileError = Object.assign(new Error("missing sentinel"), {
      code: "FILE_NOT_FOUND",
    });

    await expect(
      (sandbox as unknown as { mkdir(path: string): Promise<void> }).mkdir("/workspace"),
    ).rejects.toThrow("replaced or stopped");
    expect(delegate.mkdirCalls).toBe(0);
    expect(delegate.destroyCalls).toBe(1);
  });

  test("re-destroys a retired incarnation after a late local sentinel read", async () => {
    const sandbox = createSandbox();
    await sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);
    await sandbox.configureNetworkConstraints(FULL_NETWORK_CONSTRAINTS);
    delegate.placement = null;
    await sandbox.markRuntimeSubjectIncarnationReady(4, FULL_NETWORK_CONSTRAINTS_HASH);
    const read = createBarrier();
    const started = createBarrier();
    delegate.readFileBarrier = read.promise;
    delegate.onReadFileStart = started.release;

    const inspection = sandbox.inspectRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);
    await started.promise;
    await sandbox.destroyRuntimeSubjectIncarnation(4);
    await sandbox.alarm();
    expect(delegate.destroyCalls).toBe(2);

    read.release();
    await expect(inspection).resolves.toEqual({ kind: "retired" });
    expect(delegate.destroyCalls).toBe(3);
  });

  test("rejects and retires a mutation whose container placement changes mid-RPC", async () => {
    const sandbox = await createReadySandbox();
    delegate.onMkdir = () => {
      delegate.placement = "placement-2";
    };

    await expect(
      (sandbox as unknown as { mkdir(path: string): Promise<void> }).mkdir("/workspace"),
    ).rejects.toThrow("replaced or stopped");
    expect(delegate.mkdirCalls).toBe(1);
    expect(delegate.destroyCalls).toBe(1);
  });

  test("re-destroys a retired incarnation after a late readiness write", async () => {
    const sandbox = createSandbox();
    await sandbox.activateRuntimeSubjectIncarnation(4, FULL_NETWORK_CONSTRAINTS_HASH);
    await sandbox.configureNetworkConstraints(FULL_NETWORK_CONSTRAINTS);
    const write = createBarrier();
    const started = createBarrier();
    delegate.writeFileBarrier = write.promise;
    delegate.onWriteFileStart = started.release;

    const readiness = sandbox.markRuntimeSubjectIncarnationReady(4, FULL_NETWORK_CONSTRAINTS_HASH);
    await started.promise;
    await sandbox.destroyRuntimeSubjectIncarnation(4);
    await sandbox.alarm();
    expect(delegate.destroyCalls).toBe(2);

    write.release();
    await expect(readiness).rejects.toThrow("retired");
    expect(delegate.destroyCalls).toBe(3);
  });

  test("fences terminal sessions returned by create and get", async () => {
    const sandbox = await createReadySandbox();
    const handle = sandbox as unknown as {
      createSession(options: { id: string }): Promise<{
        terminal(request: Request): Promise<Response>;
      }>;
      getSession(id: string): Promise<{ terminal(request: Request): Promise<Response> }>;
    };
    const created = await handle.createSession({ id: "created-session" });
    const fetched = await handle.getSession("created-session");

    const byPropertyKey = (left: PropertyKey, right: PropertyKey) =>
      String(left).localeCompare(String(right));
    expect(Reflect.ownKeys(created).toSorted(byPropertyKey)).toEqual(
      delegate.lastSessionKeys.toSorted(byPropertyKey),
    );

    await expect(created.terminal(new Request("https://sandbox.test"))).resolves.toBeInstanceOf(
      Response,
    );
    await expect(fetched.terminal(new Request("https://sandbox.test"))).resolves.toBeInstanceOf(
      Response,
    );
    expect(delegate.terminalCalls).toBe(2);
  });

  test("re-destroys after a late terminal RPC resumes past the consumed alarm", async () => {
    const sandbox = await createReadySandbox();
    const handle = sandbox as unknown as {
      createSession(options: { id: string }): Promise<{
        terminal(request: Request): Promise<Response>;
      }>;
    };
    const session = await handle.createSession({ id: "terminal-session" });
    const terminal = createBarrier();
    const started = createBarrier();
    delegate.terminalBarrier = terminal.promise;
    delegate.onTerminalStart = started.release;

    const response = session.terminal(new Request("https://sandbox.test"));
    await started.promise;
    await sandbox.destroyRuntimeSubjectIncarnation(4);
    await sandbox.alarm();
    expect(delegate.destroyCalls).toBe(2);

    terminal.release();
    await expect(response).rejects.toThrow("retired during the operation");
    expect(delegate.destroyCalls).toBe(3);
  });

  test.each([
    ["successful cleanup", null],
    ["failed cleanup", new Error("destroy failed")],
  ] as const)("preserves a task failure after retirement with %s", async (_, destroyFailure) => {
    const sandbox = await createReadySandbox();
    const handle = sandbox as unknown as {
      createSession(options: { id: string }): Promise<{
        terminal(request: Request): Promise<Response>;
      }>;
    };
    const session = await handle.createSession({ id: "terminal-session" });
    const terminal = createBarrier();
    const started = createBarrier();
    const taskFailure = new Error("terminal failed");
    delegate.terminalBarrier = terminal.promise;
    delegate.terminalError = taskFailure;
    delegate.onTerminalStart = started.release;

    const response = session.terminal(new Request("https://sandbox.test"));
    await started.promise;
    await sandbox.destroyRuntimeSubjectIncarnation(4);
    delegate.destroyError = destroyFailure;
    terminal.release();

    try {
      await response;
      throw new Error("The retired RPC unexpectedly succeeded.");
    } catch (error) {
      if (destroyFailure === null) {
        expect(error).toBe(taskFailure);
      } else {
        if (!(error instanceof AggregateError)) {
          throw error;
        }
        expect(error.errors).toEqual([taskFailure, destroyFailure]);
      }
    }
    expect(delegate.destroyCalls).toBe(2);
  });

  test("rejects a late process start after the next incarnation retires its owner", async () => {
    const sandbox = await createReadySandbox();
    const handle = sandbox as unknown as {
      startProcess(command: string): Promise<ReturnType<SandboxDelegateMock["processHandle"]>>;
    };
    const process = createBarrier();
    const started = createBarrier();
    delegate.startProcessBarrier = process.promise;
    delegate.onStartProcessStart = started.release;

    const lateStart = handle.startProcess("driver");
    await started.promise;
    await sandbox.destroyRuntimeSubjectIncarnation(4);
    await sandbox.alarm();
    expect(delegate.destroyCalls).toBe(2);

    process.release();
    await expect(lateStart).rejects.toThrow("retired during the operation");
    expect(delegate.destroyCalls).toBe(3);
  });

  test("fences every Process source and method after retirement", async () => {
    const sandbox = await createReadySandbox();
    type GuardedProcess = ReturnType<SandboxDelegateMock["processHandle"]>;
    type GuardedSession = {
      getProcess(id: string): Promise<GuardedProcess>;
      listProcesses(): Promise<GuardedProcess[]>;
      startProcess(
        command: string,
        options?: { onStart(process: GuardedProcess): void },
      ): Promise<GuardedProcess>;
    };
    let callbackProcess: GuardedProcess | null = null;
    let sessionCallbackProcess: GuardedProcess | null = null;
    const handle = sandbox as unknown as {
      createSession(options: { id: string }): Promise<GuardedSession>;
      getProcess(id: string): Promise<GuardedProcess>;
      listProcesses(): Promise<GuardedProcess[]>;
      startProcess(
        command: string,
        options?: { onStart(process: GuardedProcess): void },
      ): Promise<GuardedProcess>;
    };
    const started = await handle.startProcess("driver", {
      onStart: (processHandle) => {
        callbackProcess = processHandle;
      },
    });
    expect(Object.keys(started).toSorted()).toEqual(
      Object.keys(delegate.processHandle()).toSorted(),
    );
    const fetched = await handle.getProcess("process-1");
    const [listed] = await handle.listProcesses();
    const session = await handle.createSession({ id: "process-session" });
    const sessionStarted = await session.startProcess("driver", {
      onStart: (processHandle) => {
        sessionCallbackProcess = processHandle;
      },
    });
    const sessionFetched = await session.getProcess("process-1");
    const [sessionListed] = await session.listProcesses();
    if (
      callbackProcess === null ||
      sessionCallbackProcess === null ||
      listed === undefined ||
      sessionListed === undefined
    ) {
      throw new Error("Every Process source must return a handle.");
    }
    const processes = [
      started,
      fetched,
      listed,
      callbackProcess,
      sessionStarted,
      sessionFetched,
      sessionListed,
      sessionCallbackProcess,
    ];
    const methods = [
      ["getLogs", []],
      ["getStatus", []],
      ["kill", []],
      ["waitForExit", []],
      ["waitForLog", ["ready"]],
      ["waitForPort", [8080]],
    ] as const;

    await sandbox.destroyRuntimeSubjectIncarnation(4);
    await sandbox.alarm();
    for (const process of processes) {
      for (const [method, args] of methods) {
        await expect(Reflect.apply(process[method], process, args)).rejects.toThrow("retired");
      }
    }
    expect(delegate.processActionCalls).toBe(0);
    expect(delegate.destroyCalls).toBe(2 + processes.length * methods.length);
  });

  test("leaves DTOs and established streams untouched without reopening them", async () => {
    const sandbox = await createReadySandbox();
    type Stream = ReturnType<SandboxDelegateMock["streamHandle"]>;
    const handle = sandbox as unknown as {
      createSession(options: { id: string }): Promise<{ execStream(): Promise<Stream> }>;
      exec(): Promise<typeof delegate.plainDto>;
    };
    const dto = await handle.exec();
    const session = await handle.createSession({ id: "stream-session" });
    const stream = await session.execStream();

    expect(dto).toBe(delegate.plainDto);
    expect(dto.nested).toBe(delegate.plainDto.nested);
    expect(delegate.streamOpenCalls).toBe(1);

    await sandbox.destroyRuntimeSubjectIncarnation(4);
    await sandbox.alarm();
    await expect(session.execStream()).rejects.toThrow("retired");
    expect(delegate.streamOpenCalls).toBe(1);
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
    expect(delegate.streamReadCalls).toBe(1);
  });

  test("re-destroys after a late delegate alarm resumes", async () => {
    const sandbox = await createReadySandbox();
    const alarm = createBarrier();
    const started = createBarrier();
    delegate.alarmBarrier = alarm.promise;
    delegate.onAlarmStart = started.release;

    const lateAlarm = sandbox.alarm();
    await started.promise;
    await sandbox.destroyRuntimeSubjectIncarnation(4);
    expect(delegate.destroyCalls).toBe(1);

    alarm.release();
    await lateAlarm;
    expect(delegate.destroyCalls).toBe(2);
  });

  test("aborts a wedged retired destroy while preserving its retry alarm", async () => {
    const sandbox = await createReadySandbox();
    delegate.destroyBarrier = new Promise(() => {});
    const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
    ) => {
      if (typeof callback === "function") {
        queueMicrotask(callback);
      }
      return 1;
    }) as typeof setTimeout);

    try {
      await expect(sandbox.destroyRuntimeSubjectIncarnation(4)).rejects.toThrow(
        "durable object aborted",
      );
    } finally {
      timeout.mockRestore();
    }

    expect(delegate.destroyCalls).toBe(1);
    expect(alarmWrites).toBe(2);
    expect(abortCalls).toBe(1);
    expect(abortRetryAlarm).toBe(true);
  });
});
