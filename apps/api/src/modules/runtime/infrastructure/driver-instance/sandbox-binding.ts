import { requireCloudflareSandboxBinding } from "../../../../platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";

export function requireSandboxBinding(env: ApiBindings) {
  return requireCloudflareSandboxBinding(env);
}
