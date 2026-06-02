import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import type { Session } from "./do";
import { SESSION_ID_HEADER, writeSessionViewerSocketHeaders } from "./socket-headers";

function requireSessionBinding(env: ApiBindings): DurableObjectNamespace<Session> {
  return env.Session;
}

function getSessionStub(env: ApiBindings, sessionId: SessionId): DurableObjectStub<Session> {
  const binding = requireSessionBinding(env);
  return binding.get(binding.idFromName(sessionId));
}

function createSessionDoRequest(sessionId: SessionId, path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set(SESSION_ID_HEADER, sessionId);

  return new Request(`https://session.internal${path}`, {
    ...init,
    headers,
  });
}

export async function connectSessionViewerWebSocket(
  env: ApiBindings,
  input: {
    request: Request;
    sessionId: SessionId;
    viewer: AuthenticatedViewer;
  },
): Promise<Response> {
  const headers = new Headers(input.request.headers);
  const requestUrl = new URL(input.request.url);

  writeSessionViewerSocketHeaders(headers, {
    publicOrigin: requestUrl.origin,
    sessionId: input.sessionId,
    viewer: input.viewer,
  });

  return getSessionStub(env, input.sessionId).fetch(
    createSessionDoRequest(input.sessionId, "/viewer/ws", {
      headers,
      method: input.request.method,
    }),
  );
}

export async function publishSessionViewerEvents(
  env: ApiBindings,
  sessionId: SessionId | null,
  events: AgUiSessionEvent[],
): Promise<void> {
  if (sessionId === null || sessionId === "" || events.length === 0) {
    return;
  }

  await getSessionStub(env, sessionId).publishEvents(sessionId, events);
}

export async function syncSessionViewerState(
  env: ApiBindings,
  sessionId: SessionId | null,
): Promise<void> {
  if (sessionId === null || sessionId === "") {
    return;
  }

  await getSessionStub(env, sessionId).syncViewers(sessionId);
}

export async function closeSessionViewerSockets(
  env: ApiBindings,
  sessionId: SessionId | null,
  reason: string,
): Promise<void> {
  if (sessionId === null || sessionId === "") {
    return;
  }

  await getSessionStub(env, sessionId).closeViewers(sessionId, reason);
}

export async function destroySessionDurableObject(
  env: ApiBindings,
  sessionId: SessionId | null,
  reason: string,
): Promise<void> {
  if (sessionId === null || sessionId === "") {
    return;
  }

  await getSessionStub(env, sessionId).destroy(sessionId, reason);
}
