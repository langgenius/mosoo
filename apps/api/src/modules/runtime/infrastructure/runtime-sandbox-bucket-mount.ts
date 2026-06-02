import type { ApiBindings } from "../../../platform/cloudflare/worker-types";

type RuntimeSandboxBucketProvider = "r2" | "s3" | "gcs";
const RUNTIME_SANDBOX_FILE_BUCKET_BINDING = "FILE_BUCKET";

interface RuntimeSandboxBucketMountBaseOptions {
  prefix: string;
  readOnly?: boolean;
}

interface RuntimeSandboxLocalBucketMountOptions extends RuntimeSandboxBucketMountBaseOptions {
  localBucket: true;
}

interface RuntimeSandboxRemoteBucketMountOptions extends RuntimeSandboxBucketMountBaseOptions {
  endpoint: string;
  localBucket: false;
  provider: RuntimeSandboxBucketProvider;
}

export type RuntimeSandboxBucketMountOptions =
  | RuntimeSandboxLocalBucketMountOptions
  | RuntimeSandboxRemoteBucketMountOptions;

const SANDBOX_FILE_BUCKET_LOCAL_ENV = "SANDBOX_FILE_BUCKET_LOCAL";
const CLOUDFLARE_ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";
const FILE_BUCKET_NAME_ENV = "FILE_BUCKET_NAME";

type RuntimeSandboxBucketEnvKey =
  | typeof SANDBOX_FILE_BUCKET_LOCAL_ENV
  | typeof CLOUDFLARE_ACCOUNT_ID_ENV
  | typeof FILE_BUCKET_NAME_ENV;

function requireRuntimeSandboxBucketEnv(bindings: ApiBindings, key: RuntimeSandboxBucketEnvKey) {
  const value = bindings[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required for sandbox bucket mounts.`);
  }

  return value.trim();
}

function parseRuntimeSandboxBucketBoolean(
  value: string | undefined,
  key: RuntimeSandboxBucketEnvKey,
) {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();

  switch (normalizedValue) {
    case "1":
    case "true":
    case "yes":
    case "on": {
      return true;
    }
    case "0":
    case "false":
    case "no":
    case "off": {
      return false;
    }
    default: {
      throw new Error(`${key} must be one of: true, false, 1, 0, yes, no, on, off.`);
    }
  }
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

function createRuntimeSandboxBucketEndpoint(bindings: ApiBindings): string {
  const accountId = requireRuntimeSandboxBucketEnv(bindings, CLOUDFLARE_ACCOUNT_ID_ENV);

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function isRuntimeSandboxLocalBucketEnabled(bindings: ApiBindings): boolean {
  return parseRuntimeSandboxBucketBoolean(
    bindings.SANDBOX_FILE_BUCKET_LOCAL,
    SANDBOX_FILE_BUCKET_LOCAL_ENV,
  );
}

export function createRuntimeSandboxBucketMountOptions(
  bindings: ApiBindings,
  mount: {
    prefix: string;
    readOnly?: boolean;
  },
): RuntimeSandboxBucketMountOptions {
  const localBucket = isRuntimeSandboxLocalBucketEnabled(bindings);
  const baseOptions = {
    prefix: normalizeRuntimeSandboxBucketPrefix(mount.prefix),
    readOnly: mount.readOnly ?? false,
  } satisfies RuntimeSandboxBucketMountBaseOptions;

  if (localBucket) {
    return {
      ...baseOptions,
      localBucket: true,
    };
  }

  return {
    ...baseOptions,
    endpoint: createRuntimeSandboxBucketEndpoint(bindings),
    localBucket: false,
    provider: "r2",
  };
}

function getRuntimeSandboxRemoteBucketName(bindings: ApiBindings): string {
  return requireRuntimeSandboxBucketEnv(bindings, FILE_BUCKET_NAME_ENV);
}

export function resolveRuntimeSandboxBucketMountTarget(bindings: ApiBindings): string {
  if (isRuntimeSandboxLocalBucketEnabled(bindings)) {
    return RUNTIME_SANDBOX_FILE_BUCKET_BINDING;
  }

  return getRuntimeSandboxRemoteBucketName(bindings);
}
