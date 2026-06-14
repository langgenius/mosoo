import type {
  McpCredentialRecordScope,
  McpOAuthFlowState,
  McpOAuthFlowStatus,
  StartMcpOAuthInput,
  StartMcpOAuthPayload,
} from "@mosoo/contracts/mcp";
import { mcpOauthFlowsTable } from "@mosoo/db";
import type { McpOAuthFlowId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getAppCredentialRow, writeCredential } from "./mcp-credential.repository";
import { decodeJsonArray, toOAuthFlowState } from "./mcp-mappers";
import {
  createPkcePair,
  registerDynamicOAuthClient,
} from "./mcp-oauth-client-registration.service";
import { exchangeOAuthToken, getOrDiscoverOAuthMetadata } from "./mcp-oauth-discovery.service";
import { cleanupExpiredOAuthFlows } from "./mcp-oauth-flow-cleanup.service";
import {
  clearOAuthFlowSecret,
  getOAuthFlowRowById,
  markOAuthFlowTerminal,
} from "./mcp-oauth-flow.repository";
import {
  readMcpOAuthFlowClientSecret,
  readMcpOAuthServerClientSecret,
  cleanupStoredMcpOAuthFlowClientSecret,
  storeMcpOAuthFlowClientSecret,
} from "./mcp-oauth-secret-resolution";
import { createSignedOAuthState, verifySignedOAuthState } from "./mcp-oauth-state.service";
import { OAUTH_FLOW_RESULT_RETENTION_MS, OAUTH_FLOW_TTL_MS } from "./mcp-oauth.constants";
import { createMcpOAuthFlowId, readAccountId } from "./mcp-platform-ids";
import { ensureServerAccess, getServerRow, getViewerRow } from "./mcp-server.repository";
import type { OAuthFlowRow } from "./mcp-types";
import { getCallbackUrl } from "./mcp-urls";
function getOAuthCompletionUrl(
  requestUrl: string,
  input: { flowId: McpOAuthFlowId; status: McpOAuthFlowStatus },
): string {
  const url = new URL(requestUrl);
  url.pathname = "/integrations/mcp/oauth-complete";
  url.search = "";
  url.searchParams.set("flowId", input.flowId);
  url.searchParams.set("status", input.status);
  return url.toString();
}

function redirectToOAuthCompletion(
  requestUrl: string,
  input: { flowId: McpOAuthFlowId; status: McpOAuthFlowStatus },
): Response {
  return Response.redirect(getOAuthCompletionUrl(requestUrl, input), 302);
}

export async function getMcpOAuthFlowState(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  flowId: McpOAuthFlowId,
): Promise<McpOAuthFlowState> {
  await cleanupExpiredOAuthFlows(bindings);
  const viewerId = readAccountId(viewer.id);

  const flow = await getOAuthFlowRowById(bindings.DB, flowId);

  if (!flow || flow.initiatorUserId !== viewerId) {
    throw new Error("OAuth flow not found.");
  }

  await ensureAppOwnership(bindings.DB, viewerId, flow.appId);
  const server = await getServerRow(bindings.DB, flow.serverId);
  if (server.appId !== flow.appId) {
    throw new Error("OAuth flow server is not available in this app.");
  }
  return toOAuthFlowState(flow, server);
}

export async function startMcpOAuth(
  bindings: ApiBindings,
  requestUrl: string,
  viewer: AuthenticatedViewer,
  input: StartMcpOAuthInput,
): Promise<StartMcpOAuthPayload> {
  await cleanupExpiredOAuthFlows(bindings);
  const viewerId = readAccountId(viewer.id);
  const { server } = await ensureServerAccess(bindings.DB, viewer, input.appId, input.serverId);
  const redirectUri = getCallbackUrl(requestUrl);

  if (server.authType !== "oauth") {
    throw new Error("This MCP server does not use OAuth authentication.");
  }

  const metadata = await getOrDiscoverOAuthMetadata(bindings.DB, server);
  let clientId = server.byoClientId;
  let clientSecret: string | null = null;

  if (isTruthy(server.byoClientSecretSecretId)) {
    const secret = await readMcpOAuthServerClientSecret(bindings, {
      actor: {
        accountId: viewerId,
        type: "user",
      },
      purpose: "oauth_authorization_client_secret",
      appId: server.appId,
      secretKind: "server_client_secret",
      server,
    });

    if (secret.status === "denied") {
      throw new Error(`MCP OAuth server client secret unavailable: ${secret.reason}.`);
    }

    clientSecret = secret.value;
  }

  if (!isTruthy(clientId)) {
    const registration = await registerDynamicOAuthClient(metadata, redirectUri);
    ({ clientId } = registration);
    ({ clientSecret } = registration);
  }

  if (!clientId) {
    throw new Error("OAuth client registration is not configured for this MCP server.");
  }

  const { challenge, verifier } = await createPkcePair();
  const flowId = createMcpOAuthFlowId();
  const now = currentTimestampMs();
  const flowOwner = {
    id: flowId,
    initiatorUserId: viewerId,
    organizationId: server.organizationId,
    appId: server.appId,
    serverId: server.id,
  };
  const actor = {
    accountId: viewerId,
    type: "user" as const,
  };
  const clientSecretSecretId = isTruthy(clientSecret)
    ? await storeMcpOAuthFlowClientSecret(bindings, {
        actor,
        flow: flowOwner,
        purpose: "oauth_flow_start_client_secret",
        appId: server.appId,
        secretKind: "flow_client_secret",
        value: clientSecret,
      })
    : null;

  try {
    await getAppDatabase(bindings.DB)
      .insert(mcpOauthFlowsTable)
      .values({
        authorizationEndpoint: metadata.authorization_endpoint,
        cleanupAfter: now + OAUTH_FLOW_RESULT_RETENTION_MS,
        codeVerifier: verifier,
        completedAt: null,
        createdAt: now,
        errorMessage: null,
        expiresAt: now + OAUTH_FLOW_TTL_MS,
        id: flowId,
        initiatorUserId: viewerId,
        oauthClientId: clientId,
        oauthClientSecretSecretId: clientSecretSecretId,
        organizationId: server.organizationId,
        appId: server.appId,
        registrationEndpoint: metadata.registration_endpoint ?? null,
        returnUrl: input.returnUrl ?? null,
        scopeValuesJson: JSON.stringify(metadata.scopes_supported ?? []),
        serverId: server.id,
        status: "pending",
        subjectLabel: null,
        tokenEndpoint: metadata.token_endpoint,
        updatedAt: now,
      })
      .run();
  } catch (error) {
    await cleanupStoredMcpOAuthFlowClientSecret({
      command: {
        actor,
        flow: flowOwner,
        purpose: "oauth_flow_insert_cleanup",
        appId: server.appId,
        secretId: clientSecretSecretId,
        secretKind: "flow_client_secret",
      },
      database: bindings.DB,
    });
    throw error;
  }

  const state = await createSignedOAuthState(bindings, {
    flowId,
    userId: viewerId,
  });
  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("state", state);

  const supportedScopes = metadata.scopes_supported ?? [];

  if (supportedScopes.length > 0) {
    authorizationUrl.searchParams.set("scope", supportedScopes.join(" "));
  }

  return {
    authorizationUrl: authorizationUrl.toString(),
    flowId,
  };
}

export async function completeMcpOAuthCallback(
  bindings: ApiBindings,
  request: Request,
): Promise<Response> {
  await cleanupExpiredOAuthFlows(bindings);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  let flow: OAuthFlowRow | null = null;

  try {
    if (!isTruthy(state)) {
      throw new Error("Missing OAuth state.");
    }

    const verifiedState = await verifySignedOAuthState(bindings, state);
    flow = await getOAuthFlowRowById(bindings.DB, verifiedState.flowId);

    if (!flow || flow.initiatorUserId !== verifiedState.userId) {
      throw new Error("OAuth flow is invalid or expired.");
    }

    if (flow.status !== "pending") {
      return redirectToOAuthCompletion(request.url, {
        flowId: flow.id,
        status: flow.status,
      });
    }

    if (flow.expiresAt < currentTimestampMs()) {
      await markOAuthFlowTerminal(bindings.DB, {
        errorMessage: "OAuth flow expired.",
        flowId: flow.id,
        status: "expired",
        subjectLabel: flow.subjectLabel,
      });
      await clearOAuthFlowSecret(bindings.DB, flow);
      return redirectToOAuthCompletion(request.url, {
        flowId: flow.id,
        status: "expired",
      });
    }

    if (isTruthy(error)) {
      await markOAuthFlowTerminal(bindings.DB, {
        errorMessage: error,
        flowId: flow.id,
        status: "failed",
        subjectLabel: flow.subjectLabel,
      });
      await clearOAuthFlowSecret(bindings.DB, flow);
      return redirectToOAuthCompletion(request.url, {
        flowId: flow.id,
        status: "failed",
      });
    }

    if (!isTruthy(code)) {
      throw new Error("Missing OAuth code.");
    }

    const server = await getServerRow(bindings.DB, flow.serverId);

    if (server.authType !== "oauth") {
      throw new Error("This MCP server does not use OAuth authentication.");
    }

    await ensureAppOwnership(bindings.DB, flow.initiatorUserId, flow.appId);
    if (server.appId !== flow.appId) {
      throw new Error("OAuth flow server is not available in this app.");
    }
    const clientSecretOutcome = isTruthy(flow.oauthClientSecretSecretId)
      ? await readMcpOAuthFlowClientSecret(bindings, {
          actor: {
            accountId: flow.initiatorUserId,
            type: "user",
          },
          flow,
          purpose: "oauth_callback_client_secret",
          appId: flow.appId,
          secretKind: "flow_client_secret",
          server,
        })
      : null;

    if (clientSecretOutcome !== null && clientSecretOutcome.status === "denied") {
      throw new Error(`MCP OAuth flow client secret unavailable: ${clientSecretOutcome.reason}.`);
    }

    const clientSecret = clientSecretOutcome === null ? null : clientSecretOutcome.value;
    const token = await exchangeOAuthToken({
      clientId: flow.oauthClientId,
      clientSecret,
      code,
      codeVerifier: flow.codeVerifier,
      redirectUri: getCallbackUrl(request.url),
      tokenEndpoint: flow.tokenEndpoint,
    });
    const viewerRow = await getViewerRow(bindings.DB, flow.initiatorUserId);
    const tokenExpiresAt =
      typeof token.expires_in === "number" ? currentTimestampMs() + token.expires_in * 1000 : null;
    const scopeValues = isTruthy(token.scope)
      ? token.scope.split(/\s+/).filter(Boolean)
      : decodeJsonArray(flow.scopeValuesJson);
    const scope: McpCredentialRecordScope = "app";
    const existing = await getAppCredentialRow(bindings.DB, server.id);
    const credential = await writeCredential(bindings.DB, bindings, {
      accessToken: token.access_token,
      authType: "oauth",
      credentialId: existing?.id ?? null,
      oauthClientId: flow.oauthClientId,
      oauthClientSecret: clientSecret,
      refreshToken: token.refresh_token ?? null,
      scope,
      scopeValues,
      server,
      subjectLabel: viewerRow.email ?? viewerRow.name ?? flow.initiatorUserId,
      tokenExpiresAt,
    });

    await markOAuthFlowTerminal(bindings.DB, {
      errorMessage: null,
      flowId: flow.id,
      status: "succeeded",
      subjectLabel: credential.subjectLabel,
    });
    await clearOAuthFlowSecret(bindings.DB, flow);

    return redirectToOAuthCompletion(request.url, {
      flowId: flow.id,
      status: "succeeded",
    });
  } catch (callbackError) {
    if (flow?.status === "pending") {
      await markOAuthFlowTerminal(bindings.DB, {
        errorMessage:
          callbackError instanceof Error ? callbackError.message : "OAuth callback failed.",
        flowId: flow.id,
        status: "failed",
        subjectLabel: flow.subjectLabel,
      });
      await clearOAuthFlowSecret(bindings.DB, flow);
      return redirectToOAuthCompletion(request.url, {
        flowId: flow.id,
        status: "failed",
      });
    }

    return new Response(
      callbackError instanceof Error ? callbackError.message : "OAuth callback failed.",
      {
        status: 400,
      },
    );
  }
}
