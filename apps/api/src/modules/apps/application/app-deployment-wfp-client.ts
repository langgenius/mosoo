import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

// Workers for Platforms deployment client (issue #281 migration, phase 1).
// Deploys App artifacts as User Workers inside a Mosoo-owned dispatch
// namespace through the Cloudflare REST API instead of provisioning
// account-level Pages/Worker sibling resources. The upload flow (asset
// upload session -> batched asset upload -> script PUT) follows
// cloudflare/vibesdk `worker/services/deployer`.
//
// Deploying through the REST API needs no `dispatch_namespaces` wrangler
// binding; only eyeball routing (migration phase 2) does. That keeps this
// path deployable while the namespace binding is still unprovisioned.

export interface WfpAssetFile {
  /** Raw file bytes encoded as base64 (sandbox `readFile` base64 output). */
  contentBase64: string;
  /** Asset path rooted at the deployment output directory, e.g. `/index.html`. */
  path: string;
}

export interface WfpAssetsInput {
  files: readonly WfpAssetFile[];
  notFoundHandling: "none" | "single-page-application";
}

export interface WfpWorkerDeployInput {
  assets: WfpAssetsInput | null;
  compatibilityDate: string;
  mainModule: { content: string; name: string } | null;
  scriptName: string;
  /** Plain-text env vars injected into the Worker (e.g. agent thread URLs). */
  vars: Record<string, string>;
}

export interface WfpWorkerDeployResult {
  etag: string | null;
}

export interface WfpDeploymentClient {
  deleteNamespacedWorker(input: { scriptName: string }): Promise<void>;
  deployNamespacedWorker(input: WfpWorkerDeployInput): Promise<WfpWorkerDeployResult>;
}

export type WfpClientBindings = Pick<ApiBindings, "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN">;

export interface WfpClientOptions {
  fetch?: typeof fetch;
}

const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const ERROR_BODY_PREVIEW_LENGTH = 300;

interface WfpScriptMetadata {
  assets?: {
    config: { not_found_handling: "none" | "single-page-application" };
    jwt: string;
  };
  bindings?: { name: string; text: string; type: "plain_text" }[];
  compatibility_date: string;
  main_module?: string;
}

/**
 * Resolve the configured dispatch namespace. Unset or blank means the
 * Workers for Platforms deployment path is disabled and the legacy
 * account-level Pages/Worker path stays in effect.
 */
export function wfpDispatchNamespace(
  bindings: Pick<ApiBindings, "MOSOO_WFP_DISPATCH_NAMESPACE">,
): string | null {
  const namespace = bindings.MOSOO_WFP_DISPATCH_NAMESPACE?.trim() ?? "";

  return namespace.length > 0 ? namespace : null;
}

export function createWfpDeploymentClient(
  bindings: WfpClientBindings,
  namespace: string,
  options: WfpClientOptions = {},
): WfpDeploymentClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const accountBaseUrl = `${CLOUDFLARE_API_BASE_URL}/accounts/${bindings.CLOUDFLARE_ACCOUNT_ID}/workers`;
  const scriptUrl = (scriptName: string): string =>
    `${accountBaseUrl}/dispatch/namespaces/${namespace}/scripts/${scriptName}`;

  const createAssetsUploadSession = async (
    scriptName: string,
    files: readonly WfpAssetFile[],
  ): Promise<{ buckets: string[][]; jwt: string }> => {
    const manifest: Record<string, { hash: string; size: number }> = {};

    for (const file of files) {
      const bytes = base64ToBytes(file.contentBase64);
      manifest[file.path] = { hash: await assetContentHash(bytes), size: bytes.byteLength };
    }

    const response = await fetchImpl(`${scriptUrl(scriptName)}/assets-upload-session`, {
      body: JSON.stringify({ manifest }),
      headers: {
        Authorization: `Bearer ${bindings.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw await toCloudflareApiError("asset upload session creation", response);
    }

    const payload = await response.json();

    return {
      buckets: toBuckets(readResultField(payload, "buckets")),
      jwt: toRequiredString(readResultField(payload, "jwt"), "upload session JWT"),
    };
  };

  const uploadAssetBatches = async (
    files: readonly WfpAssetFile[],
    session: { buckets: string[][]; jwt: string },
  ): Promise<string> => {
    const contentByHash = new Map<string, WfpAssetFile>();

    for (const file of files) {
      contentByHash.set(await assetContentHash(base64ToBytes(file.contentBase64)), file);
    }

    let completionJwt = session.jwt;

    for (const bucket of session.buckets) {
      const form = new FormData();

      for (const hash of bucket) {
        const file = contentByHash.get(hash);

        if (file === undefined) {
          throw new Error(`Cloudflare asset upload requested an unknown file hash: ${hash}`);
        }

        form.append(hash, new Blob([file.contentBase64], { type: assetMimeType(file.path) }), hash);
      }

      const response = await fetchImpl(`${accountBaseUrl}/assets/upload?base64=true`, {
        body: form,
        headers: { Authorization: `Bearer ${session.jwt}` },
        method: "POST",
      });

      if (!response.ok) {
        throw await toCloudflareApiError("asset batch upload", response);
      }

      if (response.status === 201) {
        completionJwt = toRequiredString(
          readResultField(await response.json(), "jwt"),
          "asset upload completion JWT",
        );
      }
    }

    return completionJwt;
  };

  return {
    async deleteNamespacedWorker(input) {
      const response = await fetchImpl(scriptUrl(input.scriptName), {
        headers: { Authorization: `Bearer ${bindings.CLOUDFLARE_API_TOKEN}` },
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        throw await toCloudflareApiError("dispatch namespace script deletion", response);
      }
    },
    async deployNamespacedWorker(input) {
      const metadata: WfpScriptMetadata = {
        compatibility_date: input.compatibilityDate,
      };

      if (input.assets !== null) {
        const session = await createAssetsUploadSession(input.scriptName, input.assets.files);

        metadata.assets = {
          config: { not_found_handling: input.assets.notFoundHandling },
          jwt: await uploadAssetBatches(input.assets.files, session),
        };
      }

      const form = new FormData();

      if (input.mainModule !== null) {
        metadata.bindings = Object.entries(input.vars).map(([name, text]) => ({
          name,
          text,
          type: "plain_text",
        }));
        metadata.main_module = input.mainModule.name;
        form.append(
          input.mainModule.name,
          new File([input.mainModule.content], input.mainModule.name, {
            type: "application/javascript+module",
          }),
          input.mainModule.name,
        );
      }

      form.append("metadata", JSON.stringify(metadata));

      const response = await fetchImpl(scriptUrl(input.scriptName), {
        body: form,
        headers: { Authorization: `Bearer ${bindings.CLOUDFLARE_API_TOKEN}` },
        method: "PUT",
      });

      if (!response.ok) {
        throw await toCloudflareApiError("dispatch namespace script deploy", response);
      }

      const etag = readResultField(await response.json(), "etag");

      return { etag: typeof etag === "string" ? etag : null };
    },
  };
}

async function assetContentHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function base64ToBytes(contentBase64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

const ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  css: "text/css",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  map: "application/json",
  mjs: "application/javascript",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain",
  wasm: "application/wasm",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml",
};

function assetMimeType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";

  return ASSET_MIME_TYPES[extension] ?? "application/octet-stream";
}

function readResultField(payload: unknown, field: string): unknown {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const result = Reflect.get(payload, "result");

  if (typeof result !== "object" || result === null) {
    return undefined;
  }

  return Reflect.get(result, field);
}

function toBuckets(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((bucket) => {
    if (!Array.isArray(bucket) || bucket.some((hash) => typeof hash !== "string")) {
      throw new Error("Cloudflare asset upload session returned malformed buckets.");
    }

    return bucket as string[];
  });
}

function toRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Cloudflare response did not include the ${label}.`);
  }

  return value;
}

async function toCloudflareApiError(operation: string, response: Response): Promise<Error> {
  const body = (await response.text()).slice(0, ERROR_BODY_PREVIEW_LENGTH);

  return new Error(`Cloudflare ${operation} failed with status ${response.status}: ${body}`);
}
