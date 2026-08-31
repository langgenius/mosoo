import type { PtyOptions } from "@cloudflare/sandbox";

import type { SandboxNetworkConstraints } from "../domain/sandbox-network-constraints";
import type { RuntimeSandboxBucketMountOptions } from "./runtime-sandbox-bucket-mount";

export interface RuntimeCommandResultHandle {
  exitCode: number;
  stderr: string;
  stdout: string;
  success: boolean;
}

export interface RuntimeFileReadHandle {
  content: string;
  encoding: "base64" | "utf8";
}

export interface RuntimeProcessExitHandle {
  exitCode: number;
}

export interface RuntimeProcessHandle {
  getLogs(): Promise<string>;
  getStatus(): Promise<string>;
  id: string;
  kill(): Promise<void>;
  pid: number;
  waitForExit(): Promise<RuntimeProcessExitHandle>;
  waitForPort(
    port: number,
    options?: {
      interval?: number;
      mode?: "http" | "tcp";
      timeout?: number;
    },
  ): Promise<void>;
}

export interface ExecutionSessionHandle {
  exec(command: string, options?: { timeout?: number }): Promise<RuntimeCommandResultHandle>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readFile(
    path: string,
    options?: { encoding?: "base64" | "utf8" },
  ): Promise<RuntimeFileReadHandle>;
  startProcess(
    command: string,
    options: {
      autoCleanup?: boolean;
      cwd?: string;
      env?: Record<string, string | undefined>;
      processId?: string;
    },
  ): Promise<RuntimeProcessHandle>;
  watch(
    path: string,
    options?: {
      exclude?: string[];
      include?: string[];
      recursive?: boolean;
    },
  ): Promise<ReadableStream<Uint8Array>>;
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: "base64" | "utf8" },
  ): Promise<void>;
}

export interface SandboxHandle extends ExecutionSessionHandle {
  configureNetworkConstraints(constraints: SandboxNetworkConstraints): Promise<void>;
  createBackup(options: {
    dir: string;
    excludes?: string[];
    localBucket?: boolean;
    name?: string;
    ttl?: number;
  }): Promise<{ dir: string; id: string }>;
  createSession(options?: {
    cwd?: string;
    env?: Record<string, string>;
    id?: string;
  }): Promise<ExecutionSessionHandle>;
  deleteSession(
    sessionId: string,
  ): Promise<{ sessionId: string; success: boolean; timestamp: string }>;
  destroy(): Promise<void>;
  getSession(sessionId: string): Promise<ExecutionSessionHandle>;
  mountBucket(
    bucket: string,
    mountPath: string,
    options: RuntimeSandboxBucketMountOptions,
  ): Promise<void>;
  restoreBackup(backup: {
    dir: string;
    id: string;
    localBucket?: boolean;
  }): Promise<{ dir: string; id: string }>;
  setKeepAlive(keepAlive: boolean): Promise<void>;
  terminal(request: Request, options?: PtyOptions): Promise<Response>;
  unmountBucket(mountPath: string): Promise<void>;
  wsConnect(request: Request, port: number): Promise<Response>;
}

export interface RuntimeSubjectIncarnationHandle {
  activateRuntimeSubjectIncarnation(
    incarnation: number,
    networkConstraintsHash: string,
  ): Promise<void>;
  createRuntimeSubjectBackup(
    incarnation: number,
    options: {
      dir: string;
      excludes?: string[];
      forbiddenPaths?: string[];
      localBucket?: boolean;
      name: string;
      ttl?: number;
    },
  ): Promise<{ dir: string; id: string }>;
  destroyRuntimeSubjectIncarnation(incarnation: number): Promise<{ kind: "destroyed" | "stale" }>;
  inspectRuntimeSubjectIncarnation(
    incarnation: number,
    networkConstraintsHash: string,
  ): Promise<{ kind: "healthy" | "missing" | "retired" | "stale" | "unknown" }>;
  markRuntimeSubjectIncarnationReady(
    incarnation: number,
    networkConstraintsHash: string,
  ): Promise<void>;
}

const SANDBOX_HANDLE_METHODS = [
  "configureNetworkConstraints",
  "createBackup",
  "createSession",
  "deleteSession",
  "destroy",
  "exec",
  "getSession",
  "mkdir",
  "mountBucket",
  "readFile",
  "restoreBackup",
  "setKeepAlive",
  "startProcess",
  "terminal",
  "unmountBucket",
  "watch",
  "writeFile",
  "wsConnect",
] as const satisfies readonly (keyof SandboxHandle)[];

export function toSandboxHandle(value: unknown): SandboxHandle {
  if (typeof value !== "object" || value === null) {
    throw new Error("Cloudflare Sandbox handle is not an object.");
  }

  for (const method of SANDBOX_HANDLE_METHODS) {
    if (typeof Reflect.get(value, method) !== "function") {
      throw new TypeError(`Cloudflare Sandbox handle is missing ${method}.`);
    }
  }

  return value as SandboxHandle;
}

export function toRuntimeSubjectIncarnationHandle(value: unknown): RuntimeSubjectIncarnationHandle {
  if (typeof value !== "object" || value === null) {
    throw new Error("Cloudflare Sandbox incarnation handle is not an object.");
  }

  for (const method of [
    "activateRuntimeSubjectIncarnation",
    "createRuntimeSubjectBackup",
    "destroyRuntimeSubjectIncarnation",
    "inspectRuntimeSubjectIncarnation",
    "markRuntimeSubjectIncarnationReady",
  ] as const) {
    if (typeof Reflect.get(value, method) !== "function") {
      throw new TypeError(`Cloudflare Sandbox incarnation handle is missing ${method}.`);
    }
  }

  return value as RuntimeSubjectIncarnationHandle;
}
