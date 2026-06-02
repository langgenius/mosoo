import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import type { StreamTextOnFinishCallback, ToolSet } from "ai";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getViewerFromRequest } from "../../auth/application/viewer-auth.service";

interface AuthenticatedSystemAgentConnectionState {
  readonly viewer: AuthenticatedViewer;
}

export interface AuthenticatedSystemAgentChatInput {
  readonly onFinish: StreamTextOnFinishCallback<ToolSet>;
  readonly options: OnChatMessageOptions;
  readonly viewer: AuthenticatedViewer;
}

export interface SystemAgentStateResult<State> {
  readonly state: State;
}

function parseChatRequestId(message: WSMessage): string | null {
  if (typeof message !== "string") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(message);

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "type" in parsed &&
      parsed.type === "cf_agent_use_chat_request" &&
      "id" in parsed &&
      typeof parsed.id === "string"
    ) {
      return parsed.id;
    }
  } catch {
    return null;
  }

  return null;
}

function readConnectionViewer(
  connection: Connection<AuthenticatedSystemAgentConnectionState>,
): AuthenticatedViewer | null {
  return connection.state?.viewer ?? null;
}

export abstract class AuthenticatedSystemAgent<State> extends AIChatAgent<Env, State> {
  protected abstract readonly systemAgentName: string;
  private readonly viewerByChatRequestId = new Map<string, AuthenticatedViewer>();

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const handleAiChatMessage = this.onMessage.bind(this);

    this.onMessage = async (connection, message) => {
      const chatRequestId = parseChatRequestId(message);
      const viewer = readConnectionViewer(
        connection as Connection<AuthenticatedSystemAgentConnectionState>,
      );

      if (chatRequestId !== null && viewer !== null) {
        this.viewerByChatRequestId.set(chatRequestId, viewer);
      }

      try {
        return await handleAiChatMessage(connection, message);
      } finally {
        if (chatRequestId !== null) {
          this.viewerByChatRequestId.delete(chatRequestId);
        }
      }
    };
  }

  override async onConnect(
    connection: Connection<AuthenticatedSystemAgentConnectionState>,
    ctx: ConnectionContext,
  ): Promise<void> {
    const viewer = await getViewerFromRequest(this.env, ctx.request);

    if (viewer === null) {
      connection.close(1008, "Authentication required.");
      return;
    }

    connection.setState({ viewer });

    await super.onConnect(connection, ctx);
  }

  override async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    if (options === undefined) {
      throw new Error(`${this.systemAgentName} chat request options are required.`);
    }

    const viewer = this.viewerByChatRequestId.get(options.requestId);

    if (viewer === undefined) {
      throw new Error(
        `${this.systemAgentName} chat request is missing authenticated viewer context.`,
      );
    }

    return this.handleAuthenticatedChatMessage({
      onFinish,
      options,
      viewer,
    });
  }

  protected abstract handleAuthenticatedChatMessage(
    input: AuthenticatedSystemAgentChatInput,
  ): Promise<Response>;

  protected syncStateFromResult<Result extends SystemAgentStateResult<State>>(
    result: Result,
  ): Result {
    this.setState(result.state);

    return result;
  }
}
