import type { ApiCommandMessage } from "../../modules/api-command/application/api-command-message";

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
  // Secrets read by @cloudflare/sandbox backups; mirrored here so the limited
  // network policy can allowlist the R2 endpoint the container will curl.
  BACKUP_BUCKET_ENDPOINT?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
}

interface OptionalProductAnalyticsBindings {
  POSTHOG_PROJECT_KEY?: string;
}

interface OptionalSkillsShBindings {
  SKILLS_SH_API_TOKEN?: string;
}

interface OptionalRuntimeSubjectPlatformBindings {
  runtimeSubjectHandleFactory?: (runtimeSubjectId: string) => unknown;
}

export type ApiBindings = Env &
  ApiCommandQueueBinding &
  OptionalLocalProviderFetchProxyBindings &
  OptionalProductAnalyticsBindings &
  OptionalRuntimeBindings &
  OptionalSkillsShBindings &
  OptionalRuntimeSubjectPlatformBindings;

export interface ApiGatewayEnvironment {
  Bindings: ApiBindings;
}
