import { mkdir } from "node:fs/promises";

import type {
  CanUseTool,
  Options as ClaudeQueryOptions,
  McpServerConfig,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { DriverBootMcpServer, DriverBootPayload } from "@mosoo/driver-protocol";

import { isTruthy } from "../../core/truthiness";
import type { AgentDriverContext } from "../agent-driver-backend";
import { buildRuntimeChildProcessEnv } from "../child-process-env";
import { buildNativeRuntimeSystemPrompt } from "../skill-bootstrap";
import { readProcessEnvString, stringifyForDisplay } from "./agent-sdk-json";
export const CLAUDE_CODE_EXECUTABLE_ENV = "MOSOO_CLAUDE_CODE_EXECUTABLE";

function createCanUseTool(context: AgentDriverContext): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    if (options.signal.aborted) {
      return {
        behavior: "deny",
        interrupt: true,
        message: "Permission request was aborted.",
        toolUseID: options.toolUseID,
      };
    }

    const decision = await context.permissions.request({
      rawInput: stringifyForDisplay(input),
      requestId: options.toolUseID,
      title: options.title ?? options.displayName ?? `Approve ${toolName}`,
      toolCallId: options.toolUseID,
      toolKind: toolName,
    });

    if (decision === "allow_once") {
      return {
        behavior: "allow",
        toolUseID: options.toolUseID,
        updatedInput: input,
      };
    }

    return {
      behavior: "deny",
      message: "Rejected by Mosoo permission review.",
      toolUseID: options.toolUseID,
    };
  };
}

function toMcpServerKey(server: DriverBootMcpServer, usedNames: Set<string>): string {
  const baseName = server.name.trim() || server.serverId;
  let candidate = baseName;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${suffix}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
}

function toClaudeMcpServers(
  servers: DriverBootMcpServer[],
): Record<string, McpServerConfig> | undefined {
  const usedNames = new Set<string>();
  const mcpServers: Record<string, McpServerConfig> = {};

  for (const server of servers) {
    if (server.authorizationState !== "active") {
      continue;
    }

    mcpServers[toMcpServerKey(server, usedNames)] = {
      headers: {
        Authorization: `Bearer ${server.proxyGrantId}`,
      },
      type: "http",
      url: server.proxyUrl,
    };
  }

  return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

function toClaudeEnv(payload: DriverBootPayload, claudeConfigDir: string): NodeJS.ProcessEnv {
  return buildRuntimeChildProcessEnv({
    ...payload.execution.environment.variables,
    CLAUDE_AGENT_SDK_CLIENT_APP: "mosoo-driver/0.1.0",
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  });
}

export function resolveClaudeConfigDir(payload: DriverBootPayload): string {
  return payload.execution.session.context.homePath;
}

export async function createClaudeQueryOptions(input: {
  abortController: AbortController;
  context: AgentDriverContext;
  nativeSessionId: string | null;
  payload: DriverBootPayload;
}): Promise<ClaudeQueryOptions> {
  const claudeConfigDir = resolveClaudeConfigDir(input.payload);
  await mkdir(claudeConfigDir, { recursive: true });

  const appendSystemPrompt = buildNativeRuntimeSystemPrompt(input.payload.execution) ?? undefined;

  const options: ClaudeQueryOptions = {
    abortController: input.abortController,
    additionalDirectories: input.payload.execution.session.additionalDirectories,
    canUseTool: createCanUseTool(input.context),
    cwd: input.payload.execution.session.cwd,
    env: toClaudeEnv(input.payload, claudeConfigDir),
    includePartialMessages: true,
    model: input.payload.execution.model,
    permissionMode: "default",
    persistSession: true,
    stderr: (data) => {
      input.context.logger.debug("driver.claude.stderr", {
        chunk: data,
      });
    },
  };

  const claudeCodeExecutable = readProcessEnvString(CLAUDE_CODE_EXECUTABLE_ENV);
  if (isTruthy(claudeCodeExecutable)) {
    options.pathToClaudeCodeExecutable = claudeCodeExecutable;
  }

  const mcpServers = toClaudeMcpServers(input.payload.execution.session.mcpServers);
  if (mcpServers) {
    options.mcpServers = mcpServers;
  }

  if (isTruthy(appendSystemPrompt)) {
    options.systemPrompt = {
      append: appendSystemPrompt,
      preset: "claude_code",
      type: "preset",
    };
  }

  if (isTruthy(input.nativeSessionId)) {
    options.resume = input.nativeSessionId;
  }

  return options;
}
