import type { Sandbox as CloudflareSandbox } from "@cloudflare/sandbox";

export const SANDBOX_RPC_FORWARD_METHODS = [
  "callDesktop",
  "callTunnels",
  "checkChanges",
  "cleanupCompletedProcesses",
  "configure",
  "createBackup",
  "createCodeContext",
  "createSession",
  "deleteCodeContext",
  "deleteFile",
  "deleteSession",
  "destroy",
  "exec",
  "execStream",
  "execStreamWithSessionToken",
  "execWithSessionToken",
  "exists",
  "exposePort",
  "getContainerPlacementId",
  "getDesktopStreamUrl",
  "getExposedPorts",
  "getProcess",
  "getProcessLogs",
  "getSession",
  "gitCheckout",
  "isPortExposed",
  "killAllProcesses",
  "killProcess",
  "listCodeContexts",
  "listFiles",
  "listProcesses",
  "mkdir",
  "mountBucket",
  "moveFile",
  "readFile",
  "readFileStream",
  "renameFile",
  "restoreBackup",
  "runCode",
  "runCodeStream",
  "setContainerTimeouts",
  "setEnvVars",
  "setKeepAlive",
  "setSandboxName",
  "setSleepAfter",
  "setTransport",
  "startProcess",
  "streamProcessLogs",
  "unexposePort",
  "unmountBucket",
  "validatePortToken",
  "watch",
  "writeFile",
] as const;

export type SandboxRpcForwardMethod = (typeof SANDBOX_RPC_FORWARD_METHODS)[number];

type MethodKeys<T> = {
  readonly [K in keyof T]-?: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T] &
  string;

type NonForwardedSandboxContainerMethod =
  | "__DURABLE_OBJECT_BRAND"
  | "alarm"
  | "allowHost"
  | "containerFetch"
  | "deleteSchedules"
  | "denyHost"
  | "fetch"
  | "getSchedule"
  | "getState"
  | "listSchedules"
  | "onActivityExpired"
  | "onError"
  | "onStart"
  | "onStop"
  | "removeAllowedHost"
  | "removeDeniedHost"
  | "removeOutboundByHost"
  | "renewActivityTimeout"
  | "schedule"
  | "scheduleNextAlarm"
  | "setAllowedHosts"
  | "setDeniedHosts"
  | "setOutboundByHost"
  | "setOutboundByHosts"
  | "setOutboundHandler"
  | "start"
  | "startAndWaitForPorts"
  | "stop"
  | "waitForPort"
  | "wsConnect";

type ForwardedSandboxSdkMethod = Exclude<
  MethodKeys<CloudflareSandbox>,
  NonForwardedSandboxContainerMethod
>;

type MissingSandboxRpcForwardMethod = Exclude<ForwardedSandboxSdkMethod, SandboxRpcForwardMethod>;

type UnknownSandboxRpcForwardMethod = Exclude<SandboxRpcForwardMethod, ForwardedSandboxSdkMethod>;

const assertNoMissingSandboxRpcForwardMethod: Record<MissingSandboxRpcForwardMethod, never> = {};
const assertNoUnknownSandboxRpcForwardMethod: Record<UnknownSandboxRpcForwardMethod, never> = {};

void assertNoMissingSandboxRpcForwardMethod;
void assertNoUnknownSandboxRpcForwardMethod;
