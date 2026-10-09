import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

const RUNTIME_SANDBOX_FILE_BUCKET_BINDING = "FILE_BUCKET";

interface RuntimeSandboxBucketMountBaseOptions {
  prefix: string;
  readOnly?: boolean;
}

interface RuntimeSandboxLocalBucketMountOptions extends RuntimeSandboxBucketMountBaseOptions {
  localBucket: true;
}

interface RuntimeSandboxRemoteBucketMountOptions extends RuntimeSandboxBucketMountBaseOptions {
  credentialProxy: true;
  endpoint: string;
  localBucket: false;
  provider: "r2";
}

export type RuntimeSandboxBucketMountOptions =
  | RuntimeSandboxLocalBucketMountOptions
  | RuntimeSandboxRemoteBucketMountOptions;

function requireRuntimeSandboxBucketEnv(
  bindings: ApiBindings,
  key: "CLOUDFLARE_ACCOUNT_ID" | "FILE_BUCKET_NAME",
) {
  const value = bindings[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required for sandbox bucket mounts.`);
  }

  return value.trim();
}

function normalizeRuntimeSandboxBucketPrefix(prefix: string): string {
  const trimmedPrefix = prefix.trim();

  if (!trimmedPrefix) {
    throw new Error("Sandbox bucket mount prefix must not be empty.");
  }

  const prefixWithLeadingSlash = trimmedPrefix.startsWith("/")
    ? trimmedPrefix
    : `/${trimmedPrefix}`;

  return prefixWithLeadingSlash.endsWith("/")
    ? prefixWithLeadingSlash
    : `${prefixWithLeadingSlash}/`;
}

export function isRuntimeSandboxLocalBucketEnabled(
  bindings: Pick<ApiBindings, "SANDBOX_FILE_BUCKET_LOCAL">,
): boolean {
  return bindings.SANDBOX_FILE_BUCKET_LOCAL === "true";
}

export function createRuntimeSandboxBucketMountOptions(
  bindings: ApiBindings,
  mount: {
    prefix: string;
    readOnly?: boolean;
  },
): RuntimeSandboxBucketMountOptions {
  const baseOptions = {
    prefix: normalizeRuntimeSandboxBucketPrefix(mount.prefix),
    readOnly: mount.readOnly ?? false,
  } satisfies RuntimeSandboxBucketMountBaseOptions;

  if (isRuntimeSandboxLocalBucketEnabled(bindings)) {
    return {
      ...baseOptions,
      localBucket: true,
    };
  }

  return {
    ...baseOptions,
    credentialProxy: true,
    endpoint: `https://${requireRuntimeSandboxBucketEnv(bindings, "CLOUDFLARE_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    localBucket: false,
    provider: "r2",
  };
}

export function resolveRuntimeSandboxBucketMountTarget(bindings: ApiBindings): string {
  if (isRuntimeSandboxLocalBucketEnabled(bindings)) {
    return RUNTIME_SANDBOX_FILE_BUCKET_BINDING;
  }

  return requireRuntimeSandboxBucketEnv(bindings, "FILE_BUCKET_NAME");
}
