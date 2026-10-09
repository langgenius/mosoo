import type { AgentId, ProjectId, SessionId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import {
  restartSessionDriver,
  recreateSessionSandbox,
} from "../../runtime/application/runtime-state-operations.service";
import {
  createAgentSession,
  sendAgentSessionEvents,
} from "../../runtime/application/session-run.service";
import { scheduleSessionPrewarm } from "../../runtime/application/session-runs/schedule-session-prewarm.service";
import { listAgentSessions } from "../application/agent-session-query.service";
import {
  getAgentSessionDiagnostics,
  retrieveThreadAgentSession,
} from "../application/agent-session-retrieve.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "../application/session-lifecycle-mutation.service";
import { getThreadSessionMessages } from "../application/session-message-query.service";
import { getThreadSessionProcessEvents } from "../application/session-process-events.service";
import { addSessionResource } from "../application/session-resource.service";
import { listThreadAgentSessions } from "../application/thread-agent-session-list.service";

interface SessionArgs {
  projectId: ProjectId;
  sessionId: SessionId;
}

interface SessionProcessEventsArgs extends SessionArgs {
  limit?: number | null;
}

interface SessionsArgs {
  archived?: Parameters<typeof listThreadAgentSessions>[2]["archived"];
  beforeCursor?: string | null;
  limit?: number | null;
  projectId: ProjectId;
  type?: Parameters<typeof listThreadAgentSessions>[2]["type"];
}

interface CreateAgentSessionArgs {
  input: Parameters<typeof createAgentSession>[0]["input"];
}

interface AddSessionResourceArgs {
  input: Parameters<typeof addSessionResource>[2];
}

interface SendAgentSessionEventsArgs extends SessionArgs {
  events: Parameters<typeof sendAgentSessionEvents>[0]["input"]["events"];
}

interface AgentSessionListArgs {
  agentId: AgentId;
  sessionId?: SessionId | null;
  archived?: Parameters<typeof listAgentSessions>[2]["archived"];
  beforeCursor?: string | null;
  limit?: number | null;
  projectId: ProjectId;
  type?: Parameters<typeof listAgentSessions>[2]["type"];
}

export const sessionGraphQLModule = {
  authenticatedMutationResolvers: {
    restartSessionDriver: async (_parent, args: SessionArgs, context) =>
      restartSessionDriver(context.bindings, context.viewer, {
        projectId: args.projectId,
        sessionId: args.sessionId,
      }),
    recreateSessionSandbox: async (_parent, args: SessionArgs, context) =>
      recreateSessionSandbox(context.bindings, context.viewer, {
        projectId: args.projectId,
        sessionId: args.sessionId,
      }),
    addSessionResource: async (_parent, args: AddSessionResourceArgs, context) =>
      addSessionResource(context.bindings, context.viewer, args.input),
    archiveAgentSession: async (_parent, args: SessionArgs, context) => {
      await archiveAgentSession({
        bindings: context.bindings,
        projectId: args.projectId,
        sessionId: args.sessionId,
        viewer: context.viewer,
      });
      return { ok: true } as const;
    },
    createAgentSession: async (_parent, args: CreateAgentSessionArgs, context) =>
      createAgentSession({
        bindings: context.bindings,
        executionContext: context.executionContext,
        input: args.input,
        options: { origin: "console_preview" },
        requestUrl: context.request.url,
        viewer: context.viewer,
      }),
    deleteAgentSession: async (_parent, args: SessionArgs, context) => {
      await deleteAgentSession({
        bindings: context.bindings,
        projectId: args.projectId,
        sessionId: args.sessionId,
        viewer: context.viewer,
      });
      return { ok: true } as const;
    },
    prewarmAgentSession: async (_parent, args: SessionArgs, context) =>
      scheduleSessionPrewarm({
        bindings: context.bindings,
        executionContext: context.executionContext,
        input: {
          projectId: args.projectId,
          sessionId: args.sessionId,
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
          projectId: args.projectId,
          sessionId: args.sessionId,
        },
        requestUrl: context.request.url,
        viewer: context.viewer,
      }),
    unarchiveAgentSession: async (_parent, args: SessionArgs, context) => {
      await unarchiveAgentSession({
        database: context.bindings.DB,
        projectId: args.projectId,
        sessionId: args.sessionId,
        viewer: context.viewer,
      });
      return { ok: true } as const;
    },
  },
  authenticatedQueryResolvers: {
    agentSessionDiagnostics: async (_parent, args: SessionArgs, context) =>
      getAgentSessionDiagnostics(context.bindings.DB, context.viewer, {
        projectId: args.projectId,
        sessionId: args.sessionId,
      }),
    agentSessionList: async (_parent, args: AgentSessionListArgs, context) =>
      listAgentSessions(context.bindings.DB, context.viewer, {
        agentId: args.agentId,
        sessionId: args.sessionId ?? null,
        archived: args.archived ?? null,
        beforeCursor: args.beforeCursor ?? null,
        limit: args.limit ?? null,
        projectId: args.projectId,
        type: args.type ?? null,
      }),
    threadAgentSessionList: async (_parent, args: SessionsArgs, context) =>
      listThreadAgentSessions(context.bindings.DB, context.viewer, {
        archived: args.archived ?? null,
        beforeCursor: args.beforeCursor ?? null,
        limit: args.limit ?? null,
        projectId: args.projectId,
        type: args.type ?? null,
      }),
    threadAgentSessionRetrieve: async (_parent, args: SessionArgs, context) =>
      retrieveThreadAgentSession(context.bindings.DB, context.viewer, {
        projectId: args.projectId,
        sessionId: args.sessionId,
      }),
    threadSessionMessages: async (_parent, args: SessionArgs, context) =>
      getThreadSessionMessages(context.bindings.DB, context.viewer, {
        projectId: args.projectId,
        sessionId: args.sessionId,
      }),
    threadSessionProcessEvents: async (_parent, args: SessionProcessEventsArgs, context) =>
      getThreadSessionProcessEvents(
        context.bindings.DB,
        context.viewer,
        {
          projectId: args.projectId,
          sessionId: args.sessionId,
        },
        {
          limit: args.limit ?? null,
        },
      ),
  },
} satisfies GraphQLModule;
