import { RPCHandler } from "@orpc/server/websocket";

import { runtimeOrpcRouter } from "./rpc-wire";

export function createDriverInstanceRpcHandler() {
  return new RPCHandler(runtimeOrpcRouter);
}
