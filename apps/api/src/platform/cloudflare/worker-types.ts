import type { ChannelConnection } from "../../adapters/durable-objects/channel-connection.do";
import type { DriverConnection } from "../../adapters/durable-objects/driver-connection.do";
import type { Sandbox } from "../../adapters/durable-objects/sandbox.do";
import type { Session } from "../../adapters/durable-objects/session.do";
import type { ApiCommandMessage } from "../../modules/api-command/application/api-command-message";
import type { ChannelFinalDeliveryMessage } from "../../modules/channels/application/channel-final-delivery-message";

interface OptionalChannelConnectionBinding {
  ChannelConnection?: DurableObjectNamespace<ChannelConnection>;
}

interface OptionalSandboxBinding {
  Sandbox?: DurableObjectNamespace<Sandbox>;
}

interface OptionalDriverConnectionBinding {
  DriverConnection?: DurableObjectNamespace<DriverConnection>;
}

interface OptionalSessionBinding {
  Session?: DurableObjectNamespace<Session>;
}

interface ChannelFinalDeliveryQueueBinding {
  CHANNEL_FINAL_DELIVERY_QUEUE: Queue<ChannelFinalDeliveryMessage>;
}

interface ApiCommandQueueBinding {
  API_COMMAND_QUEUE: Queue<ApiCommandMessage>;
}

interface OptionalLocalProviderFetchProxyBindings {
  MOSOO_PROVIDER_FETCH_PROXY_TOKEN?: string;
  MOSOO_PROVIDER_FETCH_PROXY_URL?: string;
}

interface OptionalRuntimeBindings {
  MOSOO_RUNTIME_CONTROL_ORIGIN?: string;
  MOSOO_RUNTIME_ALL_PROXY?: string;
  MOSOO_RUNTIME_HTTP_PROXY?: string;
  MOSOO_RUNTIME_HTTPS_PROXY?: string;
  MOSOO_RUNTIME_NO_PROXY?: string;
}

interface OptionalCostLedgerReconciliationBindings {
  MOSOO_COST_LEDGER_RECONCILIATION_MODE?: string;
}

// Set to a Workers for Platforms dispatch namespace name to deploy Apps as
// User Workers inside that namespace instead of provisioning account-level
// Pages/Worker sibling resources (issue #281 migration, phase 1). Deploys go
// through the Cloudflare REST API, so no `dispatch_namespaces` wrangler
// binding is required until eyeball routing (phase 2) lands. Unset or blank
// keeps the legacy deployment path.
interface OptionalWorkersForPlatformsBindings {
  MOSOO_WFP_DISPATCH_NAMESPACE?: string;
}

export interface OptionalSlackAdapterBindings {
  MOSOO_AGENT_ID?: string;
  MOSOO_API_BASE_URL?: string;
  MOSOO_API_TOKEN?: string;
  MOSOO_SESSION_LINK_BASE_URL?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_SIGNING_SECRET?: string;
}

interface OptionalWeChatIlinkBindings {
  WECHAT_ILINK_BASE_URL?: string;
}

// Set when a local Node sidecar is running the official @larksuiteoapi/node-sdk
// WSClient on the worker's behalf (the SDK's pbbp2 protobuf + Node-native `ws`
// dependencies cannot run inside workerd). The sidecar polls the bindings
// internal endpoint and posts decoded events back to the events internal
// endpoint; both endpoints are gated by this shared secret. When unset the
// WebSocket connection-mode path is dormant and webhook mode is the only
// inbound channel.
interface OptionalLarkSidecarBindings {
  MOSOO_LARK_SIDECAR_SECRET?: string;
}

interface OptionalRuntimeSubjectPlatformBindings {
  runtimeSubjectHandleFactory?: (runtimeSubjectId: string) => unknown;
}

export type ApiBindings = Env &
  ApiCommandQueueBinding &
  ChannelFinalDeliveryQueueBinding &
  OptionalChannelConnectionBinding &
  OptionalSandboxBinding &
  OptionalDriverConnectionBinding &
  OptionalSessionBinding &
  OptionalCostLedgerReconciliationBindings &
  OptionalLocalProviderFetchProxyBindings &
  OptionalRuntimeBindings &
  OptionalSlackAdapterBindings &
  OptionalWeChatIlinkBindings &
  OptionalLarkSidecarBindings &
  OptionalRuntimeSubjectPlatformBindings &
  OptionalWorkersForPlatformsBindings;

export interface ApiGatewayEnvironment {
  Bindings: ApiBindings;
}

export interface ApiServerContext extends ApiBindings {
  executionCtx: ExecutionContext;
}
