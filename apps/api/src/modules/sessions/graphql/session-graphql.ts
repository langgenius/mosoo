import { parsePlatformId } from "@mosoo/id";
import type { AgentId, AppId, SessionId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { sessionGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import {
  createAgentSession,
  sendAgentSessionEvents,
} from "../../runtime/application/session-run.service";
import { scheduleSessionPrewarm } from "../../runtime/application/session-runs/schedule-session-prewarm.service";
import { startAgentRun } from "../application/agent-run-workflow.service";
import { listAgentSessions } from "../application/agent-session-query.service";
import {
  getAgentSessionDiagnostics,
  retrieveAgentSession,
  retrieveThreadAgentSession,
} from "../application/agent-session-retrieve.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "../application/session-lifecycle-mutation.service";
import {
  getSession,
  getSessionMessages,
  getSessionProcessEvents,
  getThreadSessionMessages,
  getThreadSessionProcessEvents,
  listSessions,
} from "../application/session-query.service";
import { removeSessionResource } from "../application/session-resource-removal.service";
import { addSessionResource, listSessionResources } from "../application/session-resource.service";
import { autoTitleSession, renameSession } from "../application/session-title.service";
import { listThreadAgentSessions } from "../application/thread-agent-session-list.service";

interface SessionArgs {
  appId: string;
  sessionId: string;
}

interface SessionProcessEventsArgs extends SessionArgs {
  limit?: number | null;
}

interface SessionsArgs {
  archived?: Parameters<typeof listSessions>[2]["archived"];
  beforeCursor?: string | null;
  limit?: number | null;
  appId: string;
  type?: Parameters<typeof listSessions>[2]["type"];
}

interface RenameSessionArgs {
  input: Parameters<typeof renameSession>[0]["input"];
}

interface CreateAgentSessionArgs {
  input: Parameters<typeof createAgentSession>[0]["input"];
}

interface AddSessionResourceArgs {
  input: Parameters<typeof addSessionResource>[2];
}

interface RemoveSessionResourceArgs {
  input: Parameters<typeof removeSessionResource>[2];
}

interface SendAgentSessionEventsArgs {
  events: Parameters<typeof sendAgentSessionEvents>[0]["input"]["events"];
  appId: string;
  sessionId: string;
}

interface StartAgentRunArgs {
  input: Parameters<typeof startAgentRun>[0]["input"];
}

interface AgentSessionListArgs {
  agentId: string;
  archived?: Parameters<typeof listAgentSessions>[2]["archived"];
  beforeCursor?: string | null;
  limit?: number | null;
  participantOnly?: Parameters<typeof listAgentSessions>[2]["participantOnly"];
  appId: string;
  type?: Parameters<typeof listAgentSessions>[2]["type"];
}

interface AgentSessionRetrieveArgs {
  appId: string;
  sessionId: string;
}

function readAgentId(value: string): AgentId {
  return parsePlatformId<AgentId>(value, "Agent ID");
}

function readAppId(value: string): AppId {
  return parsePlatformId<AppId>(value, "App ID");
}

function readSessionId(value: string): SessionId {
  return parsePlatformId<SessionId>(value, "Session ID");
}

export const sessionGraphQLModule = {
  ...sessionGraphQLSpec,
  authenticatedMutationResolvers: {
    addSessionResource: async (_parent, args: AddSessionResourceArgs, context) =>
      addSessionResource(context.bindings, context.viewer, args.input),
    archiveAgentSession: async (_parent, args: SessionArgs, context) => {
      const sessionId = readSessionId(args.sessionId);
      await archiveAgentSession({
        bindings: context.bindings,
        appId: readAppId(args.appId),
        sessionId,
        viewer: context.viewer,
      });
      return { ok: true } as const;
    },
    autoTitleSession: async (_parent, args: RenameSessionArgs, context) =>
      autoTitleSession(context.bindings.DB, context.viewer, args.input),
    createAgentSession: async (_parent, args: CreateAgentSessionArgs, context) =>
      createAgentSession({
        bindings: context.bindings,
        executionContext: context.executionContext,
        input: args.input,
        requestUrl: context.request.url,
        viewer: context.viewer,
      }),
    deleteAgentSession: async (_parent, args: SessionArgs, context) => {
      const sessionId = readSessionId(args.sessionId);
      await deleteAgentSession({
        bindings: context.bindings,
        appId: readAppId(args.appId),
        sessionId,
        viewer: context.viewer,
      });
      return { ok: true } as const;
    },
    removeSessionResource: async (_parent, args: RemoveSessionResourceArgs, context) => {
      await removeSessionResource(context.bindings, context.viewer, args.input);
      return { ok: true } as const;
    },
    renameSession: async (_parent, args: RenameSessionArgs, context) =>
      renameSession({
        database: context.bindings.DB,
        input: args.input,
        viewer: context.viewer,
      }),
    prewarmAgentSession: async (_parent, args: SessionArgs, context) =>
      scheduleSessionPrewarm({
        bindings: context.bindings,
        executionContext: context.executionContext,
        input: {
          appId: readAppId(args.appId),
          sessionId: readSessionId(args.sessionId),
        },
        requestUrl: context.request.url,
        viewer: context.viewer,
      }),
    sendAgentSessionEvents: async (_parent, args: SendAgentSessionEventsArgs, context) =>
      sendAgentSessionEvents({
        bindings: context.bindings,
        executionContext: context.executionContext,
        input: {
          events: args.events,
          appId: readAppId(args.appId),
          sessionId: readSessionId(args.sessionId),
        },
        requestUrl: context.request.url,
        viewer: context.viewer,
      }),
    startAgentRun: async (_parent, args: StartAgentRunArgs, context) =>
      startAgentRun({
        bindings: context.bindings,
        executionContext: context.executionContext,
        input: args.input,
        requestUrl: context.request.url,
        viewer: context.viewer,
      }),
    unarchiveAgentSession: async (_parent, args: SessionArgs, context) => {
      const sessionId = readSessionId(args.sessionId);
      await unarchiveAgentSession({
        database: context.bindings.DB,
        appId: readAppId(args.appId),
        sessionId,
        viewer: context.viewer,
      });
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    agentSessionDiagnostics: async (_parent, args: AgentSessionRetrieveArgs, context) =>
      getAgentSessionDiagnostics(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    agentSessionList: async (_parent, args: AgentSessionListArgs, context) =>
      listAgentSessions(context.bindings.DB, context.viewer, {
        agentId: readAgentId(args.agentId),
        archived: args.archived ?? null,
        beforeCursor: args.beforeCursor ?? null,
        limit: args.limit ?? null,
        participantOnly: args.participantOnly ?? null,
        appId: readAppId(args.appId),
        type: args.type ?? null,
      }),
    agentSessionRetrieve: async (_parent, args: AgentSessionRetrieveArgs, context) =>
      retrieveAgentSession(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    listSessionResources: async (_parent, args: SessionArgs, context) =>
      listSessionResources(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    session: async (_parent, args: SessionArgs, context) =>
      getSession(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    sessionList: async (_parent, args: SessionsArgs, context) =>
      listSessions(context.bindings.DB, context.viewer, {
        archived: args.archived ?? null,
        beforeCursor: args.beforeCursor ?? null,
        limit: args.limit ?? null,
        appId: readAppId(args.appId),
        type: args.type ?? null,
      }),
    sessionMessages: async (_parent, args: SessionArgs, context) =>
      getSessionMessages(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    sessionProcessEvents: async (_parent, args: SessionProcessEventsArgs, context) =>
      getSessionProcessEvents(
        context.bindings.DB,
        context.viewer,
        {
          appId: readAppId(args.appId),
          sessionId: readSessionId(args.sessionId),
        },
        {
          limit: args.limit ?? null,
        },
      ),
    threadAgentSessionList: async (_parent, args: SessionsArgs, context) =>
      listThreadAgentSessions(context.bindings.DB, context.viewer, {
        archived: args.archived ?? null,
        beforeCursor: args.beforeCursor ?? null,
        limit: args.limit ?? null,
        appId: readAppId(args.appId),
        type: args.type ?? null,
      }),
    threadAgentSessionRetrieve: async (_parent, args: AgentSessionRetrieveArgs, context) =>
      retrieveThreadAgentSession(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    threadSessionMessages: async (_parent, args: SessionArgs, context) =>
      getThreadSessionMessages(context.bindings.DB, context.viewer, {
        appId: readAppId(args.appId),
        sessionId: readSessionId(args.sessionId),
      }),
    threadSessionProcessEvents: async (_parent, args: SessionProcessEventsArgs, context) =>
      getThreadSessionProcessEvents(
        context.bindings.DB,
        context.viewer,
        {
          appId: readAppId(args.appId),
          sessionId: readSessionId(args.sessionId),
        },
        {
          limit: args.limit ?? null,
        },
      ),
  },
} satisfies GraphQLModule;
