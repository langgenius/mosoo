/**
 * Returns redirects to the container client instead of following them inside
 * the Worker. The client's next hop then enters outbound interception again
 * and receives an independent allowlist decision.
 */
export function preventAutomaticOutboundRedirects(request: Request): Request {
  if (request.redirect !== "follow") {
    return request;
  }

  return new Request(request, { redirect: "manual" });
}
