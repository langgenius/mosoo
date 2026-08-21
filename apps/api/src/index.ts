import { arktypeWorkerConfigInitialized } from "./platform/arktype-worker-config";
import { createApiWorker } from "./platform/cloudflare/create-api-worker";
export { ContainerProxy } from "./adapters/durable-objects/sandbox-container-proxy";
export { DriverConnection } from "./adapters/durable-objects/driver-connection.do";
export { ChannelConnection } from "./adapters/durable-objects/retired-channel-connection.do";
export { Sandbox } from "./adapters/durable-objects/sandbox.do";
export { Session } from "./adapters/durable-objects/session.do";

void arktypeWorkerConfigInitialized;

export default createApiWorker();
