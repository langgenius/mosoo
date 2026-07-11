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
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  API_ERROR_CODE,
  createApiError,
  errorMessageChainIncludes,
  notFoundError,
  validationError,
} from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureAppOwnership } from "./app.service";
import type { VibeAppSnapshot, VibesdkGateway } from "./vibesdk-gateway";
import { requireVibesdkGateway } from "./vibesdk-gateway";

const INITIAL_SNAPSHOT: VibeAppSnapshot = {
  previewUrl: null,
  productionUrl: null,
  status: "generating",
  title: null,
  updatedAt: null,
};

function toAppVibeApp(row: AppVibeAppRow, snapshot: VibeAppSnapshot): AppVibeApp {
  return {
    appId: row.appId,
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    previewUrl: snapshot.previewUrl,
    productionUrl: snapshot.productionUrl,
    status: snapshot.status,
    title: snapshot.title,
    updatedAt: snapshot.updatedAt ?? toIsoString(row.updatedAt),
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

async function requireVibeAppRow(database: D1Database, appId: AppId): Promise<AppVibeAppRow> {
  const row = await readVibeAppRow(database, appId);

  if (row === null) {
    throw notFoundError("This App has no Vibe App.");
  }

  return row;
}

function requirePrompt(prompt: string): string {
  const normalized = prompt.trim();

  if (normalized.length === 0) {
    throw validationError("Prompt must not be empty.");
  }

  return normalized;
}

export async function createAppVibeApp(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: CreateAppVibeAppInput,
): Promise<AppVibeApp> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const vibe = requireVibesdkGateway(gateway);
  const prompt = requirePrompt(input.prompt);

  if ((await readVibeAppRow(database, input.appId)) !== null) {
    throw createApiError(API_ERROR_CODE.vibeAppExists, "This App already has a Vibe App.");
  }

  const vibeAppId = await vibe.createApp(prompt);
  const nowMs = currentTimestampMs();
  const row: AppVibeAppRow = {
    appId: input.appId,
    createdAt: nowMs,
    id: createPlatformId<AppVibeAppId>(),
    ownerAccountId: viewer.id,
    updatedAt: nowMs,
    vibeAppId,
  };

  try {
    await getAppDatabase(database).insert(appVibeAppsTable).values(row).run();
  } catch (error) {
    if (errorMessageChainIncludes(error, ["UNIQUE constraint failed"])) {
      await vibe.deleteApp(vibeAppId).catch(() => undefined);
      throw createApiError(API_ERROR_CODE.vibeAppExists, "This App already has a Vibe App.");
    }

    throw error;
  }

  return toAppVibeApp(row, INITIAL_SNAPSHOT);
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

  const snapshot = await requireVibesdkGateway(gateway).getApp(row.vibeAppId);
  return toAppVibeApp(row, snapshot);
}

export async function sendAppVibeAppPrompt(
  database: D1Database,
  gateway: VibesdkGateway | null,
  viewer: AuthenticatedViewer,
  input: SendAppVibeAppPromptInput,
): Promise<OperationResult> {
  await ensureAppOwnership(database, viewer.id, input.appId);
  const prompt = requirePrompt(input.prompt);
  const row = await requireVibeAppRow(database, input.appId);
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
  const row = await requireVibeAppRow(database, input.appId);
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
  const row = await requireVibeAppRow(database, input.appId);
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
  const row = await requireVibeAppRow(database, input.appId);
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

  await requireVibesdkGateway(gateway).deleteApp(row.vibeAppId);
  await getAppDatabase(database)
    .delete(appVibeAppsTable)
    .where(eq(appVibeAppsTable.id, row.id))
    .run();

  return { ok: true };
}
