import type { DriverBootPayload } from "@mosoo/driver-protocol";

import type { AgentDriverBackend } from "./agent-driver-backend";

export async function createAgentDriverBackend(
  payload: DriverBootPayload,
): Promise<AgentDriverBackend> {
  if (payload.runtimeTransport === "openai-app-server") {
    const { OpenAiAppServerDriverBackend } = await import("./openai/app-server-driver-backend");
    return new OpenAiAppServerDriverBackend(payload);
  }

  if (payload.runtimeTransport === "claude-agent-sdk") {
    const { ClaudeAgentSdkDriverBackend } = await import("./claude/agent-sdk-driver-backend");
    return new ClaudeAgentSdkDriverBackend(payload);
  }

  if (payload.runtimeTransport === "acp-fallback") {
    const { AcpDriverBackend } = await import("./acp/acp-driver-backend");
    return new AcpDriverBackend(payload);
  }

  throw new Error("Unsupported runtime transport.");
}
