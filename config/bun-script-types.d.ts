export interface BunFile {
  exists(): Promise<boolean>;
  text(): Promise<string>;
}

export interface BunServer {
  readonly port: number;
  stop(closeActiveConnections?: boolean): void;
}

export interface BunSubprocess {
  readonly exited: Promise<number>;
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
  readonly TOML: { parse(source: string): unknown };
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
