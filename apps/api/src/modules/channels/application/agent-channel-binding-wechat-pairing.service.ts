import { wechatChannelPairingsTable } from "@mosoo/db";
import type { WeChatChannelPairingId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AgentId, AppId } from "@mosoo/id";
import { and, eq, gte, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { ApiError, validationError } from "../../../platform/errors";
import type { ApiErrorCode } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { ensureAppAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  WeChatIlinkApiError,
  WeChatIlinkClient,
  WeChatIlinkHttpError,
} from "../wechat/wechat-ilink-client";
import { applyWeChatQrStatusResponse } from "../wechat/wechat-runtime";
import type { WeChatQrPairingSnapshot, WeChatQrPairingStatus } from "../wechat/wechat-runtime";
import { persistConfirmedWeChatQrPairing } from "../wechat/wechat-runtime-store";
import {
  ensureProviderBindingAvailable,
  readAgentChannelBindingById,
} from "./agent-channel-binding-records";
import type {
  PollWeChatAgentChannelPairingInput,
  StartWeChatAgentChannelPairingInput,
  WeChatAgentChannelPairing,
} from "./agent-channel-binding.types";

const WECHAT_QR_PAIRING_TTL_MS = 10 * 60 * 1000;

async function hashWeChatQrToken(qrToken: string): Promise<string> {
  const encoded = new TextEncoder().encode(qrToken);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireWeChatQrToken(qrToken: string): string {
  const trimmed = qrToken.trim();

  if (!isTruthy(trimmed)) {
    throw validationError("WeChat QR token is required.", "WECHAT_QR_TOKEN_REQUIRED");
  }

  return trimmed;
}

function createWeChatPairingNotFoundError(): ApiError {
  return validationError(
    "WeChat QR pairing was not found or has expired.",
    "WECHAT_QR_PAIRING_NOT_FOUND",
  );
}

async function storeWeChatPendingPairing(
  database: D1Database,
  input: {
    agentId: AgentId;
    createdByAccountId: AccountId;
    nowMs: number;
    appId: AppId;
    qrToken: string;
  },
): Promise<void> {
  await getAppDatabase(database)
    .insert(wechatChannelPairingsTable)
    .values({
      agentId: input.agentId,
      consumedAt: null,
      createdAt: input.nowMs,
      createdByAccountId: input.createdByAccountId,
      expiresAt: input.nowMs + WECHAT_QR_PAIRING_TTL_MS,
      id: createPlatformId<WeChatChannelPairingId>(),
      appId: input.appId,
      qrTokenHash: await hashWeChatQrToken(input.qrToken),
      updatedAt: input.nowMs,
    })
    .run();
}

async function ensureWeChatPendingPairing(
  database: D1Database,
  input: {
    agentId: AgentId;
    createdByAccountId: AccountId;
    nowMs: number;
    appId: AppId;
    qrToken: string;
  },
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({ id: wechatChannelPairingsTable.id })
      .from(wechatChannelPairingsTable)
      .where(
        and(
          eq(wechatChannelPairingsTable.agentId, input.agentId),
          eq(wechatChannelPairingsTable.createdByAccountId, input.createdByAccountId),
          eq(wechatChannelPairingsTable.appId, input.appId),
          eq(wechatChannelPairingsTable.qrTokenHash, await hashWeChatQrToken(input.qrToken)),
          isNull(wechatChannelPairingsTable.consumedAt),
          gte(wechatChannelPairingsTable.expiresAt, input.nowMs),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw createWeChatPairingNotFoundError();
  }
}

async function consumeWeChatPendingPairing(
  database: D1Database,
  input: {
    agentId: AgentId;
    createdByAccountId: AccountId;
    nowMs: number;
    appId: AppId;
    qrToken: string;
  },
): Promise<void> {
  const result = await getAppDatabase(database)
    .update(wechatChannelPairingsTable)
    .set({
      consumedAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(wechatChannelPairingsTable.agentId, input.agentId),
        eq(wechatChannelPairingsTable.createdByAccountId, input.createdByAccountId),
        eq(wechatChannelPairingsTable.appId, input.appId),
        eq(wechatChannelPairingsTable.qrTokenHash, await hashWeChatQrToken(input.qrToken)),
        isNull(wechatChannelPairingsTable.consumedAt),
        gte(wechatChannelPairingsTable.expiresAt, input.nowMs),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    throw createWeChatPairingNotFoundError();
  }
}

function createWeChatPairingSnapshot(input: {
  qrCodeImageSrc: string | null;
  qrToken: string | null;
  status: WeChatQrPairingStatus;
}): WeChatQrPairingSnapshot {
  return {
    accountId: null,
    baseUrl: null,
    botToken: null,
    expiresAtMs: null,
    ilinkBotId: null,
    ilinkUserId: null,
    lastErrorCode: null,
    qrCodeImageSrc: input.qrCodeImageSrc,
    qrToken: input.qrToken,
    status: input.status,
  };
}

function toWeChatPairingPayload(input: {
  binding?: WeChatAgentChannelPairing["binding"];
  snapshot: WeChatQrPairingSnapshot;
}): WeChatAgentChannelPairing {
  return {
    binding: input.binding ?? null,
    lastErrorCode: input.snapshot.lastErrorCode,
    qrCodeImageSrc: input.snapshot.qrCodeImageSrc,
    qrToken: input.snapshot.qrToken,
    status: input.snapshot.status,
  };
}

function mapWeChatPairingError(error: unknown, code: ApiErrorCode): Error {
  if (error instanceof WeChatIlinkApiError || error instanceof WeChatIlinkHttpError) {
    return new ApiError(502, code, "WeChat iLink setup request failed.");
  }

  if (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return new ApiError(502, code, "WeChat iLink setup request failed.");
  }

  return error instanceof Error ? error : new Error("WeChat iLink setup request failed.");
}

async function ensureAgentCanConnectWeChat(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<void> {
  const viewerId = viewer.id;
  const access = await ensureAppAgentOwner(database, viewerId, input);

  if (access.agent.status !== "published") {
    throw validationError("Publish the Agent before connecting WeChat.", "AGENT_NOT_PUBLISHED");
  }

  await ensureProviderBindingAvailable(database, {
    agentId: input.agentId,
    appId: input.appId,
    provider: "wechat",
  });
}

function createWeChatIlinkClient(bindings: ApiBindings): WeChatIlinkClient {
  return new WeChatIlinkClient(
    bindings.WECHAT_ILINK_BASE_URL ? { baseUrl: bindings.WECHAT_ILINK_BASE_URL } : undefined,
  );
}

export async function startWeChatAgentChannelPairing(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: StartWeChatAgentChannelPairingInput,
): Promise<WeChatAgentChannelPairing> {
  await ensureAgentCanConnectWeChat(bindings.DB, viewer, input);
  const viewerId = viewer.id;

  let qr: Awaited<ReturnType<WeChatIlinkClient["getBotQr"]>>;

  try {
    qr = await createWeChatIlinkClient(bindings).getBotQr();
  } catch (error) {
    throw mapWeChatPairingError(error, "WECHAT_QR_START_FAILED");
  }

  const nowMs = currentTimestampMs();
  const qrToken = requireWeChatQrToken(qr.qrToken);

  await storeWeChatPendingPairing(bindings.DB, {
    agentId: input.agentId,
    createdByAccountId: viewerId,
    nowMs,
    appId: input.appId,
    qrToken,
  });

  return toWeChatPairingPayload({
    snapshot: createWeChatPairingSnapshot({
      qrCodeImageSrc: qr.qrCodeImageContent,
      qrToken,
      status: "qr_pending",
    }),
  });
}

export async function pollWeChatAgentChannelPairing(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: PollWeChatAgentChannelPairingInput,
): Promise<WeChatAgentChannelPairing> {
  await ensureAgentCanConnectWeChat(bindings.DB, viewer, input);
  const viewerId = viewer.id;

  const nowMs = currentTimestampMs();
  const qrToken = requireWeChatQrToken(input.qrToken);

  await ensureWeChatPendingPairing(bindings.DB, {
    agentId: input.agentId,
    createdByAccountId: viewerId,
    nowMs,
    appId: input.appId,
    qrToken,
  });

  const current = createWeChatPairingSnapshot({
    qrCodeImageSrc: null,
    qrToken,
    status: "qr_pending",
  });
  let snapshot: WeChatQrPairingSnapshot;

  try {
    snapshot = applyWeChatQrStatusResponse(
      current,
      await createWeChatIlinkClient(bindings).getQrStatus({ qrToken }),
    );
  } catch (error) {
    throw mapWeChatPairingError(error, "WECHAT_QR_STATUS_FAILED");
  }

  if (snapshot.status !== "confirmed") {
    if (snapshot.status === "expired" || snapshot.status === "failed") {
      await consumeWeChatPendingPairing(bindings.DB, {
        agentId: input.agentId,
        createdByAccountId: viewerId,
        nowMs,
        appId: input.appId,
        qrToken,
      });
    }

    return toWeChatPairingPayload({ snapshot });
  }

  await consumeWeChatPendingPairing(bindings.DB, {
    agentId: input.agentId,
    createdByAccountId: viewerId,
    nowMs,
    appId: input.appId,
    qrToken,
  });

  const account = await persistConfirmedWeChatQrPairing(bindings, viewer, {
    agentId: input.agentId,
    appId: input.appId,
    snapshot,
  });

  return toWeChatPairingPayload({
    binding: await readAgentChannelBindingById(bindings.DB, account.id),
    snapshot,
  });
}
