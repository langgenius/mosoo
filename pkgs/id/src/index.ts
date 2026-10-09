import { monotonicFactory } from "ulid";

declare const PlatformIdBrand: unique symbol;
declare const SemanticPlatformIdBrand: unique symbol;

export type PlatformId = string & { readonly [PlatformIdBrand]: "PlatformId" };
export type SemanticPlatformId<Name extends string> = PlatformId & {
  readonly [SemanticPlatformIdBrand]: Name;
};

export type AccountId = SemanticPlatformId<"AccountId">;
export type AgentDeploymentVersionId = SemanticPlatformId<"AgentDeploymentVersionId">;
export type AgentId = SemanticPlatformId<"AgentId">;
export type AgentMcpBindingId = SemanticPlatformId<"AgentMcpBindingId">;
export type CliOAuthFlowId = SemanticPlatformId<"CliOAuthFlowId">;
export type CredentialId = SemanticPlatformId<"CredentialId">;
export type DriverCommandId = SemanticPlatformId<"DriverCommandId">;
export type DriverInstanceId = SemanticPlatformId<"DriverInstanceId">;
export type ExternalToolEffectId = SemanticPlatformId<"ExternalToolEffectId">;
export type EnvironmentId = SemanticPlatformId<"EnvironmentId">;
export type EnvironmentRevisionId = SemanticPlatformId<"EnvironmentRevisionId">;
export type FileId = SemanticPlatformId<"FileId">;
export type FileVersionId = SemanticPlatformId<"FileVersionId">;
export type McpOAuthFlowId = SemanticPlatformId<"McpOAuthFlowId">;
export type McpServerId = SemanticPlatformId<"McpServerId">;
export type OrganizationId = SemanticPlatformId<"OrganizationId">;
export type PersonalAccessTokenId = SemanticPlatformId<"PersonalAccessTokenId">;
export type ProjectId = SemanticPlatformId<"ProjectId">;
/** A public Thread is addressed by its backing Session ID. */
export type PublicThreadId = SessionId;
export type RuntimeEventId = SemanticPlatformId<"RuntimeEventId">;
export type RuntimeOperationId = SemanticPlatformId<"RuntimeOperationId">;
export type SandboxBackupId = SemanticPlatformId<"SandboxBackupId">;
export type SandboxId = SemanticPlatformId<"SandboxId">;
export type SandboxSessionId = SemanticPlatformId<"SandboxSessionId">;
export type SessionId = SemanticPlatformId<"SessionId">;
export type SessionMessageId = SemanticPlatformId<"SessionMessageId">;
export type SessionModelCallId = SemanticPlatformId<"SessionModelCallId">;
export type SessionRunId = SemanticPlatformId<"SessionRunId">;
export type SkillId = SemanticPlatformId<"SkillId">;
export type SkillSnapshotId = SemanticPlatformId<"SkillSnapshotId">;
export type UploadId = SemanticPlatformId<"UploadId">;
export type VendorCredentialId = SemanticPlatformId<"VendorCredentialId">;

export const PLATFORM_ID_INPUT_PATTERN = "^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$";

const canonicalPlatformIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const inputPlatformIdPattern = new RegExp(PLATFORM_ID_INPUT_PATTERN, "u");
const nextUlid = monotonicFactory();

// The caller chooses the semantic ID brand of a created or parsed ULID, so the
// type parameter appears only in the return type.
/* eslint-disable typescript/no-unnecessary-type-parameters */
export function createPlatformId<TId extends PlatformId = PlatformId>(timeMs?: number): TId {
  return nextUlid(timeMs) as TId;
}

export function parsePlatformId<TId extends PlatformId = PlatformId>(
  value: unknown,
  label = "Platform ID",
): TId {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a ULID string.`);
  }

  if (!inputPlatformIdPattern.test(value)) {
    throw new TypeError(`${label} must be a valid ULID.`);
  }

  return value.toUpperCase() as TId;
}

export function parseNullablePlatformId<TId extends PlatformId = PlatformId>(
  value: unknown,
  label?: string,
): TId | null {
  return value == null ? null : parsePlatformId<TId>(value, label);
}
/* eslint-enable typescript/no-unnecessary-type-parameters */

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && canonicalPlatformIdPattern.test(value);
}
