import type { SandboxRpcForwardMethod } from "./sandbox-rpc-methods";

export function canBypassSandboxNetworkRestore(
  method: SandboxRpcForwardMethod,
  args: readonly unknown[],
): boolean {
  return method === "destroy" || (method === "setKeepAlive" && args[0] === false);
}

export async function waitForSandboxNetworkRestore(
  restore: Promise<void>,
  method: SandboxRpcForwardMethod,
  args: readonly unknown[],
): Promise<void> {
  if (!canBypassSandboxNetworkRestore(method, args)) {
    await restore;
  }
}
