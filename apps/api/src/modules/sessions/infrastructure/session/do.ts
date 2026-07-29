import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";
import { DurableObject } from "cloudflare:workers";

import { DurableObjectIdentity } from "../../../../platform/cloudflare/durable-object-support";
import {
  createErrorLogContext,
  logError,
  runWithApiLogContext,
} from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { markRuntimeE2EViewerPublish } from "../../../runtime/infrastructure/performance/runtime-e2e-stage-evidence";
import { SessionPublicEventSocketHub } from "./public-event-socket-hub";
import { json, toErrorMessage } from "./requests";
import {
  RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA,
  runtimePerformanceIdentityEvidenceKey,
} from "./runtime-performance-identity-evidence";
import type { SessionRuntimePerformanceIdentityEvidence } from "./runtime-performance-identity-evidence";
import { SESSION_ID_HEADER } from "./socket-headers";
import { SessionViewerSocketHub } from "./viewer-socket-hub";
export class Session extends DurableObject {
  #destroyed = false;
  readonly #identity = new DurableObjectIdentity({
    mismatchMessage: "Session id does not match the active Durable Object.",
    requiredMessage: "Session id is required.",
  });
  readonly #publicEventSockets: SessionPublicEventSocketHub;
  readonly #runtimeE2EEvidenceEnabled: boolean;
  readonly #viewerSockets: SessionViewerSocketHub;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#publicEventSockets = new SessionPublicEventSocketHub({
      ctx,
      getSessionId: () => this.#identity.value,
      withSessionLogContext: (fn) => this.#withSessionLogContext(fn),
    });
    this.#runtimeE2EEvidenceEnabled = (env.MOSOO_PERF_AUTH_TOKEN?.trim().length ?? 0) > 0;
    this.#viewerSockets = new SessionViewerSocketHub({
      ctx,
      env,
      getSessionId: () => this.#identity.value,
      rememberSessionId: (sessionId) => {
        this.#identity.remember(sessionId);
      },
      withSessionLogContext: (fn) => this.#withSessionLogContext(fn),
    });
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (this.#destroyed) {
        if (request.method === "POST" && url.pathname === "/destroy") {
          return json({ ok: true });
        }

        return json({ error: "Session Durable Object was destroyed." }, { status: 410 });
      }

      const sessionId = request.headers.get(SESSION_ID_HEADER);
      this.#identity.ensure(
        sessionId === null
          ? null
          : parsePlatformId<SessionId>(sessionId, "Session Durable Object ID"),
      );

      if (url.pathname === "/viewer/ws") {
        return this.#viewerSockets.connect(request);
      }

      if (url.pathname === "/public-events/ws") {
        return this.#publicEventSockets.connect(request);
      }

      return json({ error: "Not Found" }, { status: 404 });
    } catch (error) {
      const message = toErrorMessage(error);
      this.#withSessionLogContext(() => {
        logError("session.do.request.failed", {
          ...createErrorLogContext(error),
          sessionId: this.#identity.value,
        });
      });
      return json({ error: message }, { status: 500 });
    }
  }

  override async alarm(): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    await this.#viewerSockets.handleAlarm();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    if (this.#publicEventSockets.owns(ws)) {
      return;
    }

    await this.#viewerSockets.handleSocketClose(ws, code, reason);
  }

  override webSocketError(ws: WebSocket, error: unknown): void {
    if (this.#destroyed) {
      return;
    }

    if (this.#publicEventSockets.owns(ws)) {
      return;
    }

    this.#viewerSockets.handleSocketError(ws, error);
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    if (this.#publicEventSockets.owns(ws)) {
      return;
    }

    await this.#viewerSockets.handleSocketMessage(ws, message);
  }

  #ensureActiveRpcSession(sessionId: string): SessionId {
    if (this.#destroyed) {
      throw new Error("Session Durable Object was destroyed.");
    }

    const normalizedSessionId = parsePlatformId<SessionId>(
      sessionId,
      "Session Durable Object RPC session ID",
    );
    this.#identity.ensure(normalizedSessionId);
    return normalizedSessionId;
  }

  async publishEvents(sessionId: string, events: AgUiSessionEvent[]): Promise<void> {
    const normalizedSessionId = this.#ensureActiveRpcSession(sessionId);
    if (events.length > 0) {
      this.#publicEventSockets.notifyEventsAvailable();
    }
    await this.#viewerSockets.broadcastEvents(
      this.#runtimeE2EEvidenceEnabled
        ? markRuntimeE2EViewerPublish(events, {
            nowEpochMs: Date.now,
            sessionId: normalizedSessionId,
          })
        : events,
    );
  }

  async syncViewers(sessionId: string): Promise<void> {
    this.#ensureActiveRpcSession(sessionId);
    await this.#viewerSockets.broadcastStateSync();
  }

  async closeViewers(sessionId: string, reason: string): Promise<void> {
    this.#ensureActiveRpcSession(sessionId);
    this.#viewerSockets.closeSockets(reason);
    this.#publicEventSockets.closeSockets(reason);
  }

  async recordRuntimePerformanceIdentityEvidence(
    sessionId: string,
    evidence: SessionRuntimePerformanceIdentityEvidence,
  ): Promise<void> {
    const normalizedSessionId = this.#ensureActiveRpcSession(sessionId);
    const runId = parsePlatformId<SessionRunId>(
      evidence.runId,
      "Runtime performance identity run ID",
    );
    parsePlatformId<DriverInstanceId>(
      evidence.driverInstanceId,
      "Runtime performance identity Driver instance ID",
    );
    parsePlatformId<SandboxId>(evidence.sandboxId, "Runtime performance identity Sandbox ID");
    parsePlatformId<SandboxSessionId>(
      evidence.sandboxSessionId,
      "Runtime performance identity Sandbox Session ID",
    );
    const sandboxSubjectId = parsePlatformId<SessionId>(
      evidence.sandboxSubjectId,
      "Runtime performance identity Sandbox subject ID",
    );

    if (
      evidence.schema !== RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA ||
      evidence.sessionId !== normalizedSessionId ||
      evidence.sandboxKind !== "cattle" ||
      evidence.sandboxSubjectKind !== "session" ||
      sandboxSubjectId !== normalizedSessionId
    ) {
      throw new Error("Runtime performance identity Session does not match its Durable Object.");
    }

    await this.ctx.storage.put(runtimePerformanceIdentityEvidenceKey(runId), evidence);
  }

  async readRuntimePerformanceIdentityEvidence(
    sessionId: string,
    runId: string,
  ): Promise<SessionRuntimePerformanceIdentityEvidence | null> {
    this.#ensureActiveRpcSession(sessionId);
    const normalizedRunId = parsePlatformId<SessionRunId>(
      runId,
      "Runtime performance identity run ID",
    );

    return (
      (await this.ctx.storage.get<SessionRuntimePerformanceIdentityEvidence>(
        runtimePerformanceIdentityEvidenceKey(normalizedRunId),
      )) ?? null
    );
  }

  async destroy(sessionId: string, reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    this.#identity.ensure(
      parsePlatformId<SessionId>(sessionId, "Session Durable Object RPC session ID"),
    );
    await this.#destroy(reason);
  }

  async #destroy(reason: string): Promise<void> {
    this.#destroyed = true;
    this.#viewerSockets.closeSockets(reason);
    this.#publicEventSockets.closeSockets(reason);
    this.#identity.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  #withSessionLogContext<T>(fn: () => T): T {
    return runWithApiLogContext(
      this.#identity.value !== null ? { sessionId: this.#identity.value } : {},
      fn,
    );
  }
}
