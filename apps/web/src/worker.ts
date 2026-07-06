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
    // intentionally return the index document with 200. Fetch "/" rather than
    // "/index.html": the assets binding's default html_handling
    // ("auto-trailing-slash") answers "/index.html" with a 307 to "/", and
    // passing that redirect through breaks every deep link.
    const indexRes = await env.ASSETS.fetch(new Request(new URL("/", url.origin).href, request));
    return indexRes;
  },
};
