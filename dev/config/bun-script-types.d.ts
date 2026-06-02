export interface BunFile {
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  text(): Promise<string>;
}

export interface BunHasher {
  digest(encoding: "hex"): string;
  update(value: string): BunHasher;
}

export interface BunServer {
  readonly port: number;
}

export interface BunShellOutput {
  quiet(): Promise<unknown>;
}

export interface BunSubprocess {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly pid: number;
  kill(signal?: number | string): void;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly stdin: {
    write(value: string | Uint8Array): void;
  };
  readonly stdout: ReadableStream<Uint8Array>;
}

export interface BunSpawnSyncResult {
  readonly exitCode: number;
  readonly stderr: Buffer;
  readonly stdout: Buffer;
}

interface BunProcessOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly stderr?: "inherit" | "pipe";
  readonly stdin?: "inherit" | "pipe";
  readonly stdout?: "inherit" | "pipe";
}

export interface BunRuntime {
  $(strings: TemplateStringsArray, ...values: readonly unknown[]): BunShellOutput;
  readonly CryptoHasher: new (algorithm: "sha256") => BunHasher;
  file(path: string): BunFile;
  serve(options: {
    fetch(request: Request): Promise<Response> | Response;
    hostname?: string;
    port?: number;
  }): BunServer;
  spawn(command: readonly string[], options?: BunProcessOptions): BunSubprocess;
  spawnSync(command: readonly string[], options?: BunProcessOptions): BunSpawnSyncResult;
  write(path: string, value: string | Uint8Array): Promise<number>;
}
