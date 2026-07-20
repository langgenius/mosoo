import type {
  CliOAuthDeviceConfirmRequest,
  CliOAuthDeviceConfirmResponse,
  CliOAuthDeviceStartRequest,
  CliOAuthDeviceStartResponse,
  CliOAuthDeviceStatus,
  CliOAuthDeviceTokenRequest,
  CliOAuthDeviceTokenResponse,
} from "@mosoo/contracts/auth";
import { accountsTable, cliOAuthFlowsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, CliOAuthFlowId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toBase64Url } from "../../../shared/bytes";
import { currentTimestampMs } from "../../../time";
import { createPersonalAccessToken } from "./personal-access-token.service";
import type { AuthenticatedViewer } from "./viewer-auth.service";

const CLI_OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const CLI_OAUTH_POLL_INTERVAL_SECONDS = 2;
const CLI_OAUTH_USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CLI_OAUTH_DEVICE_CODE_BYTES = 32;
const CLI_OAUTH_MAX_HOSTNAME_LENGTH = 512;

export class CliOAuthDeviceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CliOAuthDeviceError";
    this.code = code;
    this.status = status;
  }
}

interface StartCliOAuthDeviceFlowInput extends CliOAuthDeviceStartRequest {
  webOrigin: string;
}

export async function startCliOAuthDeviceFlow(
  database: D1Database,
  input: StartCliOAuthDeviceFlowInput,
): Promise<CliOAuthDeviceStartResponse> {
  const provider = normalizeProvider(input.provider);
  const webOrigin = normalizeWebOrigin(input.webOrigin);
  const hostname = normalizeHostname(input.hostname);
  const now = currentTimestampMs();
  const expiresAt = now + CLI_OAUTH_FLOW_TTL_MS;
  const nowDate = new Date(now);
  const deviceCode = createDeviceCode();
  const deviceCodeHash = await hashCliOAuthDeviceCode(deviceCode);
  const userCode = createUserCode();
  const verificationUri = new URL("/cli-auth", webOrigin);
  const verificationUriComplete = new URL(verificationUri);
  verificationUriComplete.searchParams.set("code", userCode);

  await getAppDatabase(database)
    .insert(cliOAuthFlowsTable)
    .values({
      accountId: null,
      authorizedAt: null,
      completedAt: null,
      createdAt: nowDate,
      deviceCodeHash,
      expiresAt: new Date(expiresAt),
      hostname,
      id: createPlatformId<CliOAuthFlowId>(),
      provider,
      status: "pending",
      updatedAt: nowDate,
      userCode,
    })
    .run();

  return {
    device_code: deviceCode,
    expires_in: Math.floor(CLI_OAUTH_FLOW_TTL_MS / 1000),
    interval: CLI_OAUTH_POLL_INTERVAL_SECONDS,
    user_code: userCode,
    verification_uri: verificationUri.toString(),
    verification_uri_complete: verificationUriComplete.toString(),
  };
}

export async function pollCliOAuthDeviceToken(
  database: D1Database,
  input: CliOAuthDeviceTokenRequest,
): Promise<CliOAuthDeviceTokenResponse> {
  const deviceCode = typeof input.device_code === "string" ? input.device_code.trim() : "";
  if (deviceCode === "") {
    throw new CliOAuthDeviceError(400, "invalid_request", "Device code is required.");
  }

  const deviceCodeHash = await hashCliOAuthDeviceCode(deviceCode);
  const flow =
    (await getAppDatabase(database)
      .select()
      .from(cliOAuthFlowsTable)
      .where(eq(cliOAuthFlowsTable.deviceCodeHash, deviceCodeHash))
      .limit(1)
      .get()) ?? null;

  if (!flow) {
    return { status: "expired" };
  }

  const now = currentTimestampMs();
  if (flow.expiresAt.getTime() <= now) {
    await markCliOAuthFlowStatus(database, flow.id, "expired", now, ["pending", "authorized"]);
    return { status: "expired" };
  }

  if (flow.status === "pending" || flow.status === "denied" || flow.status === "consumed") {
    return { status: flow.status };
  }

  if (flow.status === "expired") {
    return { status: "expired" };
  }

  if (!flow.accountId) {
    throw new CliOAuthDeviceError(500, "invalid_flow", "CLI OAuth flow is missing account.");
  }

  const viewer = await getViewerByAccountId(database, flow.accountId);
  if (!viewer) {
    throw new CliOAuthDeviceError(500, "invalid_flow", "CLI OAuth account no longer exists.");
  }

  const consumed = await markCliOAuthFlowStatus(database, flow.id, "consumed", now, ["authorized"]);
  if (!consumed) {
    return { status: (await readCliOAuthFlowStatus(database, flow.id)) ?? "expired" };
  }

  const token = await createPersonalAccessToken(database, viewer, {
    label: `CLI OAuth (${flow.provider})`,
  });

  return {
    access_token: token.value,
    status: "authorized",
    token_type: "Bearer",
    user: {
      email: viewer.email,
      name: viewer.name,
    },
  };
}

export async function confirmCliOAuthDeviceFlow(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CliOAuthDeviceConfirmRequest,
): Promise<CliOAuthDeviceConfirmResponse> {
  const userCode = normalizeCliOAuthUserCode(input.user_code);
  if (!userCode) {
    throw new CliOAuthDeviceError(400, "invalid_request", "User code is invalid.");
  }

  const flow =
    (await getAppDatabase(database)
      .select()
      .from(cliOAuthFlowsTable)
      .where(eq(cliOAuthFlowsTable.userCode, userCode))
      .limit(1)
      .get()) ?? null;

  if (!flow) {
    throw new CliOAuthDeviceError(404, "not_found", "CLI OAuth flow was not found.");
  }

  const now = currentTimestampMs();
  if (flow.expiresAt.getTime() <= now) {
    await markCliOAuthFlowStatus(database, flow.id, "expired", now, ["pending"]);
    return { status: "expired", user_code: userCode };
  }

  if (flow.status !== "pending") {
    return { status: flow.status, user_code: userCode };
  }

  const authorized =
    (await getAppDatabase(database)
      .update(cliOAuthFlowsTable)
      .set({
        accountId: viewer.id,
        authorizedAt: new Date(now),
        status: "authorized",
        updatedAt: new Date(now),
      })
      .where(and(eq(cliOAuthFlowsTable.id, flow.id), eq(cliOAuthFlowsTable.status, "pending")))
      .returning({ id: cliOAuthFlowsTable.id })
      .get()) ?? null;

  if (!authorized) {
    return {
      status: (await readCliOAuthFlowStatus(database, flow.id)) ?? "expired",
      user_code: userCode,
    };
  }

  return { status: "authorized", user_code: userCode };
}

export async function hashCliOAuthDeviceCode(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export function normalizeCliOAuthUserCode(value: string): string | null {
  const normalized = value
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, "");
  if (normalized.length !== 8) {
    return null;
  }

  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

function normalizeProvider(value: string | undefined): "google" {
  const provider = value?.trim().toLowerCase() || "google";
  if (provider !== "google") {
    throw new CliOAuthDeviceError(
      400,
      "unsupported_provider",
      "mosoo CLI OAuth supports google only.",
    );
  }
  return "google";
}

function normalizeWebOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliOAuthDeviceError(500, "invalid_config", "WEB_ORIGIN is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliOAuthDeviceError(500, "invalid_config", "WEB_ORIGIN must use http or https.");
  }
  return url.origin;
}

function normalizeHostname(value: string | undefined): string | null {
  const hostname = value?.trim() ?? "";
  if (hostname === "") {
    return null;
  }
  if (hostname.length > CLI_OAUTH_MAX_HOSTNAME_LENGTH) {
    throw new CliOAuthDeviceError(400, "invalid_request", "Hostname is too long.");
  }
  return hostname;
}

function createDeviceCode(): string {
  const bytes = new Uint8Array(CLI_OAUTH_DEVICE_CODE_BYTES);
  crypto.getRandomValues(bytes);
  return `cli_${toBase64Url(bytes)}`;
}

function createUserCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => {
    const index = byte % CLI_OAUTH_USER_CODE_ALPHABET.length;
    return CLI_OAUTH_USER_CODE_ALPHABET[index] ?? "A";
  }).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

async function markCliOAuthFlowStatus(
  database: D1Database,
  flowId: CliOAuthFlowId,
  status: CliOAuthDeviceStatus,
  timestampMs: number,
  expectedStatuses?: CliOAuthDeviceStatus[],
): Promise<boolean> {
  const timestamp = new Date(timestampMs);
  const predicates = [eq(cliOAuthFlowsTable.id, flowId)];
  if (expectedStatuses && expectedStatuses.length > 0) {
    predicates.push(inArray(cliOAuthFlowsTable.status, expectedStatuses));
  }

  const updated =
    (await getAppDatabase(database)
      .update(cliOAuthFlowsTable)
      .set({
        completedAt:
          status === "expired" || status === "consumed" || status === "denied" ? timestamp : null,
        status,
        updatedAt: timestamp,
      })
      .where(and(...predicates))
      .returning({ id: cliOAuthFlowsTable.id })
      .get()) ?? null;

  return updated !== null;
}

async function readCliOAuthFlowStatus(
  database: D1Database,
  flowId: CliOAuthFlowId,
): Promise<CliOAuthDeviceStatus | null> {
  const row =
    (await getAppDatabase(database)
      .select({ status: cliOAuthFlowsTable.status })
      .from(cliOAuthFlowsTable)
      .where(eq(cliOAuthFlowsTable.id, flowId))
      .limit(1)
      .get()) ?? null;

  return row?.status ?? null;
}

async function getViewerByAccountId(
  database: D1Database,
  accountId: AccountId,
): Promise<AuthenticatedViewer | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        email: accountsTable.email,
        emailVerified: accountsTable.emailVerified,
        id: accountsTable.id,
        imageUrl: accountsTable.image,
        name: accountsTable.name,
      })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    email: row.email,
    emailVerified: row.emailVerified,
    id: row.id,
    imageUrl: row.imageUrl,
    name: row.name,
  };
}
