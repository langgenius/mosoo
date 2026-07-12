import type {
  AppVibeApp,
  AppVibeAppCloneUrl,
  AppVibeAppTargetInput,
  CreateAppVibeAppInput,
  SendAppVibeAppPromptInput,
} from "@mosoo/contracts/app";
import type { OperationResult } from "@mosoo/contracts/operation-result";
import type { AppVibeAppRow } from "@mosoo/db";
import { appVibeAppsTable } from "@mosoo/db";
import type { AppId, AppVibeAppId } from "@mosoo/id";
import { createPlatformId } from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  API_ERROR_CODE,
  createApiError,
  errorMessageChainIncludes,
  notFoundError,
  validationError,
} from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import { enqueueVibeAppCreateCommand } from "../../api-command/application/api-command-enqueue";
import type { VibeAppCreateCommandPayload } from "../../api-command/application/api-command-payload";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAppOwnership } from "./app.service";
import type { VibeAppSnapshot, VibesdkGateway, VibesdkGatewayTimeouts } from "./vibesdk-gateway";
import { createVibesdkGateway, requireVibesdkGateway } from "./vibesdk-gateway";

// The queue consumer holds no user request open, so the create budget only
// has to stay inside the consumer's generous wall clock. Blueprint streaming
// on a real VibeSDK instance measures 60s+ for even trivial prompts.
const CREATE_CONSUMER_TIMEOUTS: VibesdkGatewayTimeouts = {
  commandAckMs: 10_000,
  createMs: 240_000,
  generationStartedMs: 30_000,
};

type AttachedVibeAppRow = AppVibeAppRow & { vibeAppId: string };

function toCreatingAppVibeApp(row: AppVibeAppRow): AppVibeApp {
  return {
    appId: row.appId,
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    lastPublishedAt: null,
    previewUrl: null,
    productionUrl: null,
    status: "creating",
    title: null,
    updatedAt: toIsoString(row.createdAt),
    vibeAppId: null,
  };
}

function toAppVibeApp(row: AttachedVibeAppRow, snapshot: VibeAppSnapshot): AppVibeApp {
  return {
    appId: row.appId,
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    lastPublishedAt: snapshot.lastPublishedAt,
    previewUrl: snapshot.previewUrl,
    productionUrl: snapshot.productionUrl,
    status: snapshot.status,
    title: snapshot.title,
    updatedAt: snapshot.updatedAt ?? toIsoString(row.createdAt),
    vibeAppId: row.vibeAppId,
  };
}

async function readVibeAppRow(database: D1Database, appId: AppId): Promise<AppVibeAppRow | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(appVibeAppsTable)
      .where(eq(appVibeAppsTable.appId, appId))
      .limit(1)
      .get()) ?? null
  );
}

async function requireAttachedVibeAppRow(
  database: D1Database,
  appId: AppId,
): Promise<AttachedVibeAppRow> {
  const row = await readVibeAppRow(database, appId);

  if (row === null) {
    throw notFoundError("This App has no Vibe App.");
  }

  if (row.vibeAppId === null) {
    throw validationError("The app is still being created — try again in a moment.");
  }

  return row as AttachedVibeAppRow;
}

function requirePrompt(prompt: string): string {
  const normalized = prompt.trim();

  if (normalized.length === 0) {
    throw validationError("Prompt must not be empty.");
  }

  return normalized;
}

export async function createAppVibeApp(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: CreateAppVibeAppInput,
): Promise<AppVibeApp> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);
  requireVibesdkGateway(gateway);
  const prompt = requirePrompt(input.prompt);

  if ((await readVibeAppRow(bindings.DB, input.appId)) !== null) {
    throw createApiError(API_ERROR_CODE.vibeAppExists, "This App already has a Vibe App.");
  }

  const row: AppVibeAppRow = {
    appId: input.appId,
    createdAt: currentTimestampMs(),
    id: createPlatformId<AppVibeAppId>(),
    vibeAppId: null,
  };

  try {
    await getAppDatabase(bindings.DB).insert(appVibeAppsTable).values(row).run();
  } catch (error) {
    if (errorMessageChainIncludes(error, ["UNIQUE constraint failed"])) {
      throw createApiError(API_ERROR_CODE.vibeAppExists, "This App already has a Vibe App.");
    }

    throw error;
  }

  await enqueueVibeAppCreateCommand(bindings, { bindingId: row.id, prompt });
  return toCreatingAppVibeApp(row);
}

/**
 * Queue-consumer side of create: run the slow VibeSDK build (blueprint
 * streaming takes minutes) and attach the resulting remote app to the
 * binding. Cleans up after itself instead of throwing — the build is not
 * idempotent, so a queue retry would double-create.
 */
export async function runVibeAppCreate(
  bindings: Pick<ApiBindings, "DB" | "VIBESDK_API_KEY" | "VIBESDK_BASE_URL">,
  payload: VibeAppCreateCommandPayload,
  injectedGateway?: VibesdkGateway | null,
): Promise<void> {
  const database = getAppDatabase(bindings.DB);
  const row =
    (await database
      .select()
      .from(appVibeAppsTable)
      .where(eq(appVibeAppsTable.id, payload.bindingId))
      .limit(1)
      .get()) ?? null;

  if (row === null || row.vibeAppId !== null) {
    return;
  }

  try {
    const gateway = requireVibesdkGateway(
      injectedGateway ?? createVibesdkGateway(bindings, CREATE_CONSUMER_TIMEOUTS),
    );
    const vibeAppId = await gateway.createApp(payload.prompt);
    const update = await database
      .update(appVibeAppsTable)
      .set({ vibeAppId })
      .where(and(eq(appVibeAppsTable.id, payload.bindingId), isNull(appVibeAppsTable.vibeAppId)))
      .run();

    if (update.meta.changes === 0) {
      // The owner deleted the binding while the build ran.
      await gateway.deleteApp(vibeAppId).catch(() => undefined);
    }
  } catch (error) {
    logError("vibe-app.create.failed", {
      ...createErrorLogContext(error),
      bindingId: payload.bindingId,
    });
    await database
      .delete(appVibeAppsTable)
      .where(and(eq(appVibeAppsTable.id, payload.bindingId), isNull(appVibeAppsTable.vibeAppId)))
      .run();
  }
}

export async function getAppVibeApp(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<AppVibeApp | null> {
  await ensureAppOwnership(database, viewer.id, appId);
  const row = await readVibeAppRow(database, appId);

  if (row === null) {
    return null;
  }

  if (row.vibeAppId === null) {
    return toCreatingAppVibeApp(row);
  }

  const snapshot = await requireVibesdkGateway(gateway).getApp(row.vibeAppId);
  return toAppVibeApp(row as AttachedVibeAppRow, snapshot);
}

export async function sendAppVibeAppPrompt(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: SendAppVibeAppPromptInput,
): Promise<OperationResult> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const prompt = requirePrompt(input.prompt);
  const row = await requireAttachedVibeAppRow(database, input.appId);
  await requireVibesdkGateway(gateway).sendPrompt(row.vibeAppId, prompt);
  return { ok: true };
}

export async function publishAppVibeApp(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: AppVibeAppTargetInput,
): Promise<OperationResult> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const row = await requireAttachedVibeAppRow(database, input.appId);
  await requireVibesdkGateway(gateway).publish(row.vibeAppId);
  return { ok: true };
}

export async function refreshAppVibeAppPreview(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: AppVibeAppTargetInput,
): Promise<OperationResult> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const row = await requireAttachedVibeAppRow(database, input.appId);
  await requireVibesdkGateway(gateway).refreshPreview(row.vibeAppId);
  return { ok: true };
}

export async function createAppVibeAppCloneUrl(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: AppVibeAppTargetInput,
): Promise<AppVibeAppCloneUrl> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const row = await requireAttachedVibeAppRow(database, input.appId);
  return requireVibesdkGateway(gateway).createCloneUrl(row.vibeAppId);
}

export async function deleteAppVibeApp(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: AppVibeAppTargetInput,
): Promise<OperationResult> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const row = await readVibeAppRow(database, input.appId);

  if (row === null) {
    return { ok: true };
  }

  // A still-creating binding has no known remote app; the create consumer
  // deletes the remote side itself when it finds the row gone.
  if (row.vibeAppId !== null) {
    await requireVibesdkGateway(gateway).deleteApp(row.vibeAppId);
  }

  await getAppDatabase(database)
    .delete(appVibeAppsTable)
    .where(eq(appVibeAppsTable.id, row.id))
    .run();

  return { ok: true };
}
