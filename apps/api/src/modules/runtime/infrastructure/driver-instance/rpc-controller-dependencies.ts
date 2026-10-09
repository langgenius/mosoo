import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { DriverInstanceRuntimeState } from "./runtime-state";
import type { DriverInstanceSocketRegistry } from "./sockets";

export interface DriverInstanceRpcControllerDependencies {
  env: ApiBindings;
  finalizeTerminalState: () => Promise<void>;
  sockets: DriverInstanceSocketRegistry;
  state: DriverInstanceRuntimeState;
  waitUntil: (task: Promise<unknown>) => void;
  withRuntimeLogContext: <T>(fn: () => T) => T;
}
