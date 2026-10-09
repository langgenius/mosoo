import type {
  McpOAuthFlowState,
  McpOAuthFlowStatus,
  StartMcpOAuthInput,
  StartMcpOAuthPayload,
} from "@mosoo/contracts/mcp";
import { mcpOauthFlowsTable } from "@mosoo/db";
import { ignorePromiseRejection } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { McpOAuthFlowId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteSecret, readSecret, storeSecret } from "../../vault/application/vault-secret-store";
import { getProjectCredentialRow, writeCredential } from "./mcp-credential.repository";
import { decodeJsonArray, toOAuthFlowState } from "./mcp-mappers";
import {
  createPkcePair,
  registerDynamicOAuthClient,
} from "./mcp-oauth-client-registration.service";
import { discoverOAuthMetadata, exchangeOAuthToken } from "./mcp-oauth-discovery.service";
import { cleanupExpiredOAuthFlows } from "./mcp-oauth-flow-cleanup.service";
import { getOAuthFlowRowById, markOAuthFlowTerminal } from "./mcp-oauth-flow.repository";
import { createSignedOAuthState, verifySignedOAuthState } from "./mcp-oauth-state.service";
import {
  MCP_OAUTH_CLIENT_SECRET_KIND,
  OAUTH_FLOW_RESULT_RETENTION_MS,
  OAUTH_FLOW_TTL_MS,
} from "./mcp-oauth.constants";
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
  const flow = await getOAuthFlowRowById(bindings.DB, flowId);

  if (!flow || flow.initiatorUserId !== viewer.id) {
    throw new Error("OAuth flow not found.");
  }

  return toOAuthFlowState(flow, await getServerRow(bindings.DB, flow.serverId));
}

export async function startMcpOAuth(
  bindings: ApiBindings,
  requestUrl: string,
  viewer: AuthenticatedViewer,
  input: StartMcpOAuthInput,
): Promise<StartMcpOAuthPayload> {
  await cleanupExpiredOAuthFlows(bindings);
  const server = await ensureServerAccess(bindings.DB, viewer, input.projectId, input.serverId);
  const redirectUri = getCallbackUrl(requestUrl);

  if (server.authType !== "oauth") {
    throw new Error("This MCP server does not use OAuth authentication.");
  }

  const metadata = await discoverOAuthMetadata(server.url);
  let clientId = server.byoClientId;
  let clientSecret = isTruthy(server.byoClientSecretSecretId)
    ? await readSecret(bindings.DB, bindings, server.byoClientSecretSecretId)
    : null;

  if (!isTruthy(clientId)) {
    ({ clientId, clientSecret } = await registerDynamicOAuthClient(metadata, redirectUri));
  }

  const { challenge, verifier } = await createPkcePair();
  const flowId = createPlatformId<McpOAuthFlowId>();
  const now = currentTimestampMs();
  const clientSecretSecretId = isTruthy(clientSecret)
    ? await storeSecret(bindings.DB, bindings, {
        kind: MCP_OAUTH_CLIENT_SECRET_KIND,
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
        initiatorUserId: viewer.id,
        oauthClientId: clientId,
        oauthClientSecretSecretId: clientSecretSecretId,
        projectId: server.projectId,
        registrationEndpoint: metadata.registration_endpoint ?? null,
        scopeValuesJson: JSON.stringify(metadata.scopes_supported ?? []),
        serverId: server.id,
        status: "pending",
        subjectLabel: null,
        tokenEndpoint: metadata.token_endpoint,
        updatedAt: now,
      })
      .run();
  } catch (error) {
    await deleteSecret(bindings.DB, clientSecretSecretId).catch(ignorePromiseRejection);
    throw error;
  }

  const state = await createSignedOAuthState(bindings, {
    flowId,
    userId: viewer.id,
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
      await markOAuthFlowTerminal(bindings.DB, flow, {
        errorMessage: "OAuth flow expired.",
        status: "expired",
        subjectLabel: flow.subjectLabel,
      });
      return redirectToOAuthCompletion(request.url, {
        flowId: flow.id,
        status: "expired",
      });
    }

    if (isTruthy(error)) {
      await markOAuthFlowTerminal(bindings.DB, flow, {
        errorMessage: error,
        status: "failed",
        subjectLabel: flow.subjectLabel,
      });
      return redirectToOAuthCompletion(request.url, {
        flowId: flow.id,
        status: "failed",
      });
    }

    if (!isTruthy(code)) {
      throw new Error("Missing OAuth code.");
    }

    const server = await getServerRow(bindings.DB, flow.serverId);
    const clientSecret = isTruthy(flow.oauthClientSecretSecretId)
      ? await readSecret(bindings.DB, bindings, flow.oauthClientSecretSecretId)
      : null;
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
    const existing = await getProjectCredentialRow(bindings.DB, server.id);
    const credential = await writeCredential(bindings.DB, bindings, {
      accessToken: token.access_token,
      authType: "oauth",
      credentialId: existing?.id ?? null,
      oauthClientId: flow.oauthClientId,
      oauthClientSecret: clientSecret,
      refreshToken: token.refresh_token ?? null,
      scopeValues,
      server,
      subjectLabel: viewerRow.email ?? viewerRow.name ?? flow.initiatorUserId,
      tokenExpiresAt,
    });

    await markOAuthFlowTerminal(bindings.DB, flow, {
      errorMessage: null,
      status: "succeeded",
      subjectLabel: credential.subjectLabel,
    });

    return redirectToOAuthCompletion(request.url, {
      flowId: flow.id,
      status: "succeeded",
    });
  } catch (callbackError) {
    if (flow?.status === "pending") {
      await markOAuthFlowTerminal(bindings.DB, flow, {
        errorMessage:
          callbackError instanceof Error ? callbackError.message : "OAuth callback failed.",
        status: "failed",
        subjectLabel: flow.subjectLabel,
      });
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
