import { runtimeOrpcRouter } from "@mosoo/driver-protocol";
import { RPCHandler } from "@orpc/server/websocket";

export function createDriverInstanceRpcHandler() {
  return new RPCHandler(runtimeOrpcRouter);
}
