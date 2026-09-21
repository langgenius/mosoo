import { ContainerProxy as CloudflareSandboxContainerProxy } from "@cloudflare/sandbox";

import { logInfo } from "../../platform/cloudflare/logger";
import { preventAutomaticOutboundRedirects } from "./sandbox-container-proxy-request";

/**
 * The upstream ContainerProxy validates only the first request hostname before
 * passing the request to Workers fetch. Force redirect handling back to the
 * container client so every redirect hop becomes a new intercepted request and
 * is checked against the allowlist independently.
 */
export class ContainerProxy extends CloudflareSandboxContainerProxy {
  override async fetch(request: Request): Promise<Response> {
    const response = await super.fetch(preventAutomaticOutboundRedirects(request));
    if (response.status >= 500) {
      // Includes intentional SDK allowlist denials (520). This is an egress
      // result, not an API response. Keep thrown proxy/Worker faults distinct.
      logInfo("runtime.sandbox.egress.http_error", { httpStatus: response.status });
    }
    return response;
  }
}
