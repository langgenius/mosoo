import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { RuntimeSessionViewCache } from "./runtime-session-view-cache";
import type { DriverInstanceRuntimeState } from "./runtime-state";
import type { SessionViewerEventDeliveryBuffer } from "./session-viewer-event-delivery-buffer";
import type { DriverInstanceSocketRegistry } from "./sockets";

export interface DriverInstanceRpcControllerDependencies {
  env: ApiBindings;
  finalizeTerminalState: () => Promise<void>;
  sockets: DriverInstanceSocketRegistry;
  state: DriverInstanceRuntimeState;
  viewCache: RuntimeSessionViewCache;
  viewerEventDelivery: SessionViewerEventDeliveryBuffer;
  withRuntimeLogContext: <T>(fn: () => T) => T;
}
