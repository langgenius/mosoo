// Locally-typed binding so we don't have to pull `@cloudflare/workers-types`
// into the SPA build. ASSETS is provided by Workers Assets and only exposes
// `fetch` at runtime.
interface AssetsBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}
export interface Env {
  readonly ASSETS: AssetsBinding;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const assetRes = await env.ASSETS.fetch(request);

    // Asset binding found something — let the response through.
    if (assetRes.status !== 404) {
      return assetRes;
    }

    // SPA route — react-router decides what to render client-side, so we
    // intentionally return /index.html with 200.
    const indexRes = await env.ASSETS.fetch(
      new Request(new URL("/index.html", url.origin).href, request),
    );
    return indexRes;
  },
};
