import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
} from "@mosoo/driver-protocol";

import type { AcpAuthMethod, AcpInitializeResult, AcpMcpServer, JsonObject } from "./acp-types";
import { isRecord, readRecord } from "./acp-types";

export const ACP_PROTOCOL_VERSION = 1 as const;
const ACP_RUNTIME_HOME_DIR = "acp-fallback";
const ACP_DEFAULT_COMMAND = "acp-agent";

export function readAcpFallbackCommand(): string {
  const command = process.env["MOSOO_ACP_FALLBACK_COMMAND"];
  return typeof command === "string" && command.trim().length > 0
    ? command.trim()
    : ACP_DEFAULT_COMMAND;
}

export function readAcpFallbackArgs(): string[] {
  const rawArgs = process.env["MOSOO_ACP_FALLBACK_ARGS"];

  if (typeof rawArgs !== "string" || rawArgs.trim().length === 0) {
    return [];
  }

  const parsed: unknown = JSON.parse(rawArgs);

  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
    throw new Error("MOSOO_ACP_FALLBACK_ARGS must be a JSON string array.");
  }

  return parsed;
}

export function buildAcpChildProcessEnv(payload: DriverBootPayload): Record<string, string> {
  const { homePath } = payload.execution.session.context;

  return {
    ...payload.execution.environment.variables,
    DISABLE_AUTOUPDATER: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_TELEMETRY: "1",
    MOSOO_ACP_HOME: `${homePath}/${ACP_RUNTIME_HOME_DIR}`,
    HOME: homePath,
    IS_SANDBOX: "1",
    PATH: process.env["PATH"] ?? "",
    PWD: payload.execution.session.cwd,
  };
}

export function buildAcpClientCapabilities(): JsonObject {
  return {
    fs: {
      readTextFile: true,
      writeTextFile: true,
    },
    terminal: true,
  };
}

export function buildAcpMcpServers(payload: DriverBootPayload): AcpMcpServer[] {
  return payload.execution.session.mcpServers.flatMap((server): AcpMcpServer[] => {
    if (server.authorizationState !== "active") {
      return [];
    }

    return [
      {
        _meta: {
          "mosoo.ai/credentialId": server.credentialId,
          "mosoo.ai/credentialScope": server.credentialScope,
          "mosoo.ai/serverId": server.serverId,
        },
        headers: [
          {
            name: "Authorization",
            value: `Bearer ${server.proxyGrantId}`,
          },
        ],
        name: server.name,
        type: "http",
        url: server.proxyUrl,
      },
    ];
  });
}

export function enforceAcpMcpSupport(
  agentCapabilities: JsonObject | null,
  servers: AcpMcpServer[],
): void {
  if (servers.length === 0) {
    return;
  }

  const mcpCapabilities = readRecord(agentCapabilities, "mcpCapabilities");

  if (mcpCapabilities?.["http"] === true) {
    return;
  }

  throw new Error("ACP agent does not advertise HTTP MCP support.");
}

export function enforceAcpProtocolVersion(result: AcpInitializeResult): void {
  if (
    result.protocolVersion === ACP_PROTOCOL_VERSION ||
    result.protocolVersion === String(ACP_PROTOCOL_VERSION)
  ) {
    return;
  }

  throw new Error(
    `ACP agent returned unsupported protocol version: ${String(result.protocolVersion ?? "missing")}.`,
  );
}

export function readAcpNativeResumeSessionId(payload: DriverBootPayload): string | null {
  const ref = payload.execution.session.nativeResumeRef;

  if (ref === null) {
    return null;
  }

  if (ref.runtimeId !== "acp-fallback" || ref.kind !== "acp_session_id") {
    throw new Error("ACP fallback received an incompatible native resume ref.");
  }

  return ref.value;
}

export function resolveAcpAuthMethodId(
  authMethods: readonly AcpAuthMethod[],
  env: Record<string, string>,
): string | null {
  const requestedMethodId = env["MOSOO_ACP_AUTH_METHOD_ID"]?.trim();

  if (typeof requestedMethodId !== "string" || requestedMethodId.length === 0) {
    return null;
  }

  if (authMethods.some((method) => method.id === requestedMethodId)) {
    return requestedMethodId;
  }

  throw new Error(`Configured ACP auth method is not advertised: ${requestedMethodId}.`);
}

export function toAcpRequestMeta(input: {
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  payload: DriverBootPayload;
}): JsonObject {
  const { context } = input.payload.execution.session;

  return {
    "mosoo.ai/organizationAccessSnapshot": input.organizationAccessSnapshot,
    "mosoo.ai/origin": context.origin,
    "mosoo.ai/sessionContext": context,
  };
}

export function supportsAcpSessionClose(agentCapabilities: JsonObject | null): boolean {
  return isRecord(readRecord(agentCapabilities, "sessionCapabilities")?.["close"]);
}

export function supportsAcpSessionLoad(agentCapabilities: JsonObject | null): boolean {
  return agentCapabilities?.["loadSession"] === true;
}

export function supportsAcpSessionResume(agentCapabilities: JsonObject | null): boolean {
  return isRecord(readRecord(agentCapabilities, "sessionCapabilities")?.["resume"]);
}
