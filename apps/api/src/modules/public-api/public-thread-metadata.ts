import { parsePlatformId } from "@mosoo/id";
import type { AppDeploymentId, AppDeploymentRunId, PersonalAccessTokenId } from "@mosoo/id";

const ACCESS_TOKEN_CREATED_BY_FIELDS = new Set(["token_id", "token_label"]);
const DEPLOYMENT_CAPABILITY_CREATED_BY_FIELDS = new Set([
  "binding_env",
  "binding_name",
  "deployment_id",
  "deployment_run_id",
  "kind",
]);
const PUBLIC_API_FIELDS = new Set(["created_by", "idempotency_key", "source"]);

/** Thread created by an owner Access Token (the original Public Thread API caller). */
export interface PublicApiThreadAccessTokenCreatedByMetadata {
  token_id: PersonalAccessTokenId;
  token_label: string;
}

/**
 * Thread created by a deployed App through its bound Agent capability. The
 * Deployment is the visibility boundary for that identity: a capability only
 * reads Threads whose `deployment_id` matches its own claims, so one App's
 * deployment can never observe another deployment's or the owner's Threads.
 */
export interface PublicApiThreadDeploymentCapabilityCreatedByMetadata {
  binding_env: string;
  binding_name: string;
  deployment_id: AppDeploymentId;
  deployment_run_id: AppDeploymentRunId;
  kind: "deployment_capability";
}

export type PublicApiThreadCreatedByMetadata =
  | PublicApiThreadAccessTokenCreatedByMetadata
  | PublicApiThreadDeploymentCapabilityCreatedByMetadata;

export interface PublicApiThreadMetadata {
  created_by: PublicApiThreadCreatedByMetadata;
  idempotency_key: string | null;
  source: "public_api";
}

interface PublicApiThreadMetadataInput {
  createdBy: PublicApiThreadCreatedByMetadata;
  idempotencyKey: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return Object.keys(value).every((field) => fields.has(field));
}

export function isDeploymentCapabilityCreatedBy(
  createdBy: PublicApiThreadCreatedByMetadata,
): createdBy is PublicApiThreadDeploymentCapabilityCreatedByMetadata {
  return "kind" in createdBy && createdBy.kind === "deployment_capability";
}

function readAccessTokenCreatedByMetadata(
  value: Record<string, unknown>,
): PublicApiThreadAccessTokenCreatedByMetadata | null {
  if (!hasOnlyFields(value, ACCESS_TOKEN_CREATED_BY_FIELDS)) {
    return null;
  }

  const tokenId = value["token_id"];
  const tokenLabel = value["token_label"];

  if (typeof tokenId !== "string" || typeof tokenLabel !== "string") {
    return null;
  }

  try {
    return {
      token_id: parsePlatformId<PersonalAccessTokenId>(tokenId, "Public API token ID"),
      token_label: tokenLabel,
    };
  } catch {
    return null;
  }
}

function readDeploymentCapabilityCreatedByMetadata(
  value: Record<string, unknown>,
): PublicApiThreadDeploymentCapabilityCreatedByMetadata | null {
  if (!hasOnlyFields(value, DEPLOYMENT_CAPABILITY_CREATED_BY_FIELDS)) {
    return null;
  }

  const bindingEnv = value["binding_env"];
  const bindingName = value["binding_name"];
  const deploymentId = value["deployment_id"];
  const deploymentRunId = value["deployment_run_id"];

  if (
    typeof bindingEnv !== "string" ||
    bindingEnv.length === 0 ||
    typeof bindingName !== "string" ||
    bindingName.length === 0 ||
    typeof deploymentId !== "string" ||
    typeof deploymentRunId !== "string"
  ) {
    return null;
  }

  try {
    return {
      binding_env: bindingEnv,
      binding_name: bindingName,
      deployment_id: parsePlatformId<AppDeploymentId>(deploymentId, "Public API deployment ID"),
      deployment_run_id: parsePlatformId<AppDeploymentRunId>(
        deploymentRunId,
        "Public API deployment run ID",
      ),
      kind: "deployment_capability",
    };
  } catch {
    return null;
  }
}

function readCreatedByMetadata(value: unknown): PublicApiThreadCreatedByMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  // Access Token threads predate the `kind` discriminator; their shape is
  // exactly `{ token_id, token_label }` and must keep parsing unchanged.
  return value["kind"] === "deployment_capability"
    ? readDeploymentCapabilityCreatedByMetadata(value)
    : readAccessTokenCreatedByMetadata(value);
}

export function createPublicApiThreadMetadata(
  input: PublicApiThreadMetadataInput,
): PublicApiThreadMetadata {
  return {
    created_by: input.createdBy,
    idempotency_key: input.idempotencyKey,
    source: "public_api",
  };
}

export function parsePublicApiThreadMetadata(raw: string): PublicApiThreadMetadata | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const metadata = parsed["public_api"];

  if (
    !isRecord(metadata) ||
    !hasOnlyFields(metadata, PUBLIC_API_FIELDS) ||
    metadata["source"] !== "public_api"
  ) {
    return null;
  }

  const createdBy = readCreatedByMetadata(metadata["created_by"]);
  const idempotencyKey = metadata["idempotency_key"];

  if ((idempotencyKey !== null && typeof idempotencyKey !== "string") || createdBy === null) {
    return null;
  }

  return {
    created_by: createdBy,
    idempotency_key: idempotencyKey,
    source: "public_api",
  };
}
