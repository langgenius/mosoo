import { decodeTime, encodeTime, incrementBase32, TIME_MAX } from "ulid";

declare const PlatformIdBrand: unique symbol;
declare const SemanticPlatformIdBrand: unique symbol;

export type PlatformId = string & { readonly [PlatformIdBrand]: "PlatformId" };
export type SemanticPlatformId<Name extends string> = PlatformId & {
  readonly [SemanticPlatformIdBrand]: Name;
};

export type AccountId = SemanticPlatformId<"AccountId">;
export type AgentBuilderMessageId = SemanticPlatformId<"AgentBuilderMessageId">;
export type AgentBuilderPlannerRunId = SemanticPlatformId<"AgentBuilderPlannerRunId">;
export type AgentBuilderThreadId = SemanticPlatformId<"AgentBuilderThreadId">;
export type AgentDeploymentVersionId = SemanticPlatformId<"AgentDeploymentVersionId">;
export type AgentId = SemanticPlatformId<"AgentId">;
export type AgentMcpBindingId = SemanticPlatformId<"AgentMcpBindingId">;
export type AuditEventId = SemanticPlatformId<"AuditEventId">;
export type ChannelBindingId = SemanticPlatformId<"ChannelBindingId">;
export type CredentialId = SemanticPlatformId<"CredentialId">;
export type DriverCommandId = SemanticPlatformId<"DriverCommandId">;
export type DriverInstanceId = SemanticPlatformId<"DriverInstanceId">;
export type EnvironmentId = SemanticPlatformId<"EnvironmentId">;
export type EnvironmentRevisionId = SemanticPlatformId<"EnvironmentRevisionId">;
export type FileId = SemanticPlatformId<"FileId">;
export type McpOAuthFlowId = SemanticPlatformId<"McpOAuthFlowId">;
export type McpServerId = SemanticPlatformId<"McpServerId">;
export type OrganizationAccessRequestId = SemanticPlatformId<"OrganizationAccessRequestId">;
export type OrganizationId = SemanticPlatformId<"OrganizationId">;
export type OrganizationInvitationId = SemanticPlatformId<"OrganizationInvitationId">;
export type OrganizationServiceTokenId = SemanticPlatformId<"OrganizationServiceTokenId">;
export type PersonalAccessTokenId = SemanticPlatformId<"PersonalAccessTokenId">;
export type PublicThreadId = SemanticPlatformId<"PublicThreadId">;
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
export type SpaceFileVersionId = SemanticPlatformId<"SpaceFileVersionId">;
export type SpaceId = SemanticPlatformId<"SpaceId">;
export type UploadId = SemanticPlatformId<"UploadId">;
export type VendorCredentialId = SemanticPlatformId<"VendorCredentialId">;

export const PLATFORM_ID_PATTERN = "^[0-7][0-9A-HJKMNP-TV-Z]{25}$";
export const PLATFORM_ID_INPUT_PATTERN = "^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$";

const canonicalPlatformIdPattern = new RegExp(PLATFORM_ID_PATTERN, "u");
const inputPlatformIdPattern = new RegExp(PLATFORM_ID_INPUT_PATTERN, "u");
const platformIdRandomAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const platformIdRandomLength = 16;

let lastPlatformIdTimeMs = -1;
let lastPlatformIdRandom: string | undefined;

type PlatformIdCrypto = {
  getRandomValues(bytes: Uint8Array): Uint8Array;
};

interface CreatePlatformId {
  <TId extends PlatformId = PlatformId>(timeMs?: number, narrow?: (id: PlatformId) => TId): TId;
}

interface NormalizePlatformId {
  <TId extends PlatformId = PlatformId>(
    value: string,
    label?: string,
    narrow?: (id: PlatformId) => TId,
  ): TId;
}

interface ParsePlatformId {
  <TId extends PlatformId = PlatformId>(
    value: unknown,
    label?: string,
    narrow?: (id: PlatformId) => TId,
  ): TId;
}

interface ParseNullablePlatformId {
  <TId extends PlatformId = PlatformId>(
    value: unknown,
    label?: string,
    narrow?: (id: PlatformId) => TId,
  ): TId | null;
}

interface ParsePlatformIdList {
  <TId extends PlatformId = PlatformId>(
    values: readonly unknown[],
    label?: string,
    narrow?: (id: PlatformId) => TId,
  ): TId[];
}

interface AssertPlatformId {
  <TId extends PlatformId = PlatformId>(
    value: unknown,
    label?: string,
    narrow?: (id: PlatformId) => TId,
  ): TId;
}

function brandPlatformId(value: string): PlatformId {
  return value as PlatformId;
}

function formatPlatformIdLabel(label: string | undefined): string {
  const normalized = label?.trim();
  return normalized && normalized.length > 0 ? normalized : "Platform ID";
}

function assertPlatformIdTimeMs(timeMs: number): number {
  if (!Number.isFinite(timeMs) || !Number.isSafeInteger(timeMs)) {
    throw new TypeError("Platform ID timeMs must be a finite safe integer.");
  }

  if (timeMs < 0 || timeMs > TIME_MAX) {
    throw new RangeError(
      `Platform ID timeMs must be within the ULID timestamp range 0..${TIME_MAX}.`,
    );
  }

  return timeMs;
}

function readRandomByte(): number {
  const crypto = (globalThis as { readonly crypto?: PlatformIdCrypto }).crypto;

  if (crypto === undefined) {
    throw new TypeError("Platform ID generation requires globalThis.crypto.");
  }

  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);

  const byte = bytes[0];
  if (byte === undefined) {
    throw new TypeError("Platform ID generation failed to read random bytes.");
  }

  return byte;
}

function createPlatformIdRandom(): string {
  let value = "";

  for (let index = 0; index < platformIdRandomLength; index += 1) {
    const char = platformIdRandomAlphabet[readRandomByte() % platformIdRandomAlphabet.length];

    if (char === undefined) {
      throw new TypeError("Platform ID generation failed to encode random bytes.");
    }

    value += char;
  }

  return value;
}

function createPlatformIdValue(timeMs?: number): PlatformId {
  const requestedTimeMs = assertPlatformIdTimeMs(timeMs ?? Date.now());

  if (requestedTimeMs <= lastPlatformIdTimeMs && lastPlatformIdRandom !== undefined) {
    lastPlatformIdRandom = incrementBase32(lastPlatformIdRandom);
    return brandPlatformId(`${encodeTime(lastPlatformIdTimeMs)}${lastPlatformIdRandom}`);
  }

  lastPlatformIdTimeMs = requestedTimeMs;
  lastPlatformIdRandom = createPlatformIdRandom();

  return brandPlatformId(`${encodeTime(requestedTimeMs)}${lastPlatformIdRandom}`);
}

export const createPlatformId = createPlatformIdValue as CreatePlatformId;

function normalizePlatformIdValue(value: string, label?: string): PlatformId {
  if (!inputPlatformIdPattern.test(value)) {
    throw new TypeError(`${formatPlatformIdLabel(label)} must be a valid ULID.`);
  }

  return brandPlatformId(value.toUpperCase());
}

export const normalizePlatformId = normalizePlatformIdValue as NormalizePlatformId;

function parsePlatformIdValue(value: unknown, label?: string): PlatformId {
  if (typeof value !== "string") {
    throw new TypeError(`${formatPlatformIdLabel(label)} must be a ULID string.`);
  }

  return normalizePlatformIdValue(value, label);
}

export const parsePlatformId = parsePlatformIdValue as ParsePlatformId;

function parseNullablePlatformIdValue(value: unknown, label?: string): PlatformId | null {
  return value == null ? null : parsePlatformIdValue(value, label);
}

export const parseNullablePlatformId = parseNullablePlatformIdValue as ParseNullablePlatformId;

function parsePlatformIdListValue(values: readonly unknown[], label?: string): PlatformId[] {
  return values.map((value, index) =>
    parsePlatformIdValue(value, `${formatPlatformIdLabel(label)}[${index}]`),
  );
}

export const parsePlatformIdList = parsePlatformIdListValue as ParsePlatformIdList;

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && canonicalPlatformIdPattern.test(value);
}

function assertPlatformIdValue(value: unknown, label?: string): PlatformId {
  if (!isPlatformId(value)) {
    throw new TypeError(`${formatPlatformIdLabel(label)} must be a canonical ULID.`);
  }

  return value;
}

export const assertPlatformId = assertPlatformIdValue as AssertPlatformId;

export function comparePlatformIds(left: PlatformId, right: PlatformId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortPlatformIds<TId extends PlatformId>(ids: readonly TId[]): TId[] {
  return ids.toSorted(comparePlatformIds);
}

export function readPlatformIdTime(id: PlatformId): number {
  return decodeTime(id);
}
