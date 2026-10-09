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
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: "base64" | "utf8" },
  ): Promise<void>;
}

export interface SandboxHandle extends ExecutionSessionHandle {
  ensureContainerReady(options: { allowRecovery: boolean }): Promise<void>;
  configureNetworkConstraints(constraints: SandboxNetworkConstraints): Promise<void>;
  createBackup(options: {
    dir: string;
    localBucket?: boolean;
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
  unmountBucket(mountPath: string): Promise<void>;
}
