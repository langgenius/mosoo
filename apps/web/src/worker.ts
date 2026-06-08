/**
 * mosoo-web Worker entry.
 *
 * The product SPA and the static blog (apps/blog → built into dist/blog/) live
 * behind the same Cloudflare Worker so we run **one** prod deployment instead
 * of two. The default `not_found_handling = "single-page-application"` would
 * answer every miss with the SPA shell at 200 — fine for the app, but for the
 * blog that produces a **soft 404** (Google indexes the SPA shell against a
 * deleted blog URL). So this entry runs first, asks the assets binding for the
 * file, and forks the miss path:
 *
 *   - `/blog`, `/blog/...` → serve the static blog 404 page with status 404.
 *   - anything else        → SPA fallback: serve `/index.html` with status 200
 *                            so react-router can take over.
 *
 * `wrangler.toml` sets `not_found_handling = "none"` so the binding never
 * fakes a 200; everything below is in this file.
 */

// Locally-typed binding so we don't have to pull `@cloudflare/workers-types`
// into the SPA build. ASSETS is provided by Workers Assets and only exposes
// `fetch` at runtime.
interface AssetsBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}
export interface Env {
  readonly ASSETS: AssetsBinding;
}

function isBlogPath(pathname: string): boolean {
  return pathname === "/blog" || pathname.startsWith("/blog/");
}

async function copyResponseWithStatus(res: Response, status: number): Promise<Response> {
  const body = await res.arrayBuffer();
  return new Response(body, {
    status,
    statusText: status === 404 ? "Not Found" : res.statusText,
    headers: res.headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const assetRes = await env.ASSETS.fetch(request);

    // Asset binding found something — let the response through.
    if (assetRes.status !== 404) {
      return assetRes;
    }

    if (isBlogPath(url.pathname)) {
      // Serve the static blog 404 with a real 404 status code. Astro writes
      // its 404.astro to `<base>/404.html`, which after the embed step lives
      // at `/blog/404.html` from the worker's point of view.
      const blogNotFound = await env.ASSETS.fetch(
        new Request(new URL("/blog/404.html", url.origin).href, request),
      );
      if (blogNotFound.status !== 404) {
        return copyResponseWithStatus(blogNotFound, 404);
      }
      // Defensive fallback if 404.html itself somehow went missing.
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // SPA route — react-router decides what to render client-side, so we
    // intentionally return /index.html with 200.
    const indexRes = await env.ASSETS.fetch(
      new Request(new URL("/index.html", url.origin).href, request),
    );
    return indexRes;
  },
};
