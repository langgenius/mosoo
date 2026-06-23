import { arktypeWorkerConfigInitialized } from "./platform/arktype-worker-config";
import { createApiWorker } from "./platform/cloudflare/create-api-worker";
export { ChannelConnection } from "./adapters/durable-objects/channel-connection.do";
export { DriverConnection } from "./adapters/durable-objects/driver-connection.do";
export { Sandbox } from "./adapters/durable-objects/sandbox.do";
export { Session } from "./adapters/durable-objects/session.do";

void arktypeWorkerConfigInitialized;

export default createApiWorker();
