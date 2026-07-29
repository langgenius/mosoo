import { ContainerProxy as CloudflareSandboxContainerProxy } from "@cloudflare/sandbox";

import { preventAutomaticOutboundRedirects } from "./sandbox-container-proxy-request";

/**
 * The upstream ContainerProxy validates only the first request hostname before
 * passing the request to Workers fetch. Force redirect handling back to the
 * container client so every redirect hop becomes a new intercepted request and
 * is checked against the allowlist independently.
 */
export class ContainerProxy extends CloudflareSandboxContainerProxy {
  override fetch(request: Request): Promise<Response> {
    return super.fetch(preventAutomaticOutboundRedirects(request));
  }
}
