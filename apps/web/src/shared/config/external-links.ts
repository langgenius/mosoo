export const MOSOO_GITHUB_URL = "https://github.com/langgenius/mosoo/";

// TODO: replace with the verified product X (Twitter) handle once confirmed.
export const MOSOO_X_URL = "https://x.com/mosoo";

export const MOSOO_API_REFERENCE_URL = "https://app.mintlify.com/dify-da2aabea/dify-da2aabea";

export const MOSOO_DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${MOSOO_GITHUB_URL}`;

export const MOSOO_DOCS_URL = `${MOSOO_GITHUB_URL}blob/main/README.md`;
export const MOSOO_RELEASES_URL = `${MOSOO_GITHUB_URL}releases`;
export const MOSOO_LICENSE_URL = `${MOSOO_GITHUB_URL}blob/main/LICENSE`;
export const MOSOO_SECURITY_URL = `${MOSOO_GITHUB_URL}security`;

// Blog lives at /blog on the same custom domain but is served by a separate
// Cloudflare Worker (apps/blog). Use a plain <a href> so the browser leaves
// the SPA and lets the blog worker take over.
export const MOSOO_BLOG_URL = "/blog";
