import type { RuntimeCatalogCapabilityId } from "@mosoo/runtime-catalog";
import { getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

type SessionEventCapabilityId = Extract<
  RuntimeCatalogCapabilityId,
  "custom_tool_execute" | "mcp_execute" | "thinking_stream" | "tool_stream" | "usage"
>;

export interface SessionEventCapabilitySummary {
  id: SessionEventCapabilityId;
  label: string;
  status: "supported" | "unsupported";
}

const SESSION_EVENT_CAPABILITY_SPECS: {
  id: SessionEventCapabilityId;
  label: string;
}[] = [
  { id: "thinking_stream", label: "thinking" },
  { id: "tool_stream", label: "tools" },
  { id: "mcp_execute", label: "MCP" },
  { id: "custom_tool_execute", label: "custom" },
  { id: "usage", label: "usage" },
];

export function getSessionEventCapabilitySummary(
  runtimeId: string,
): SessionEventCapabilitySummary[] {
  const runtime = getRuntimeCatalogEntry(runtimeId);

  if (runtime === null) {
    return [];
  }

  const statusById = new Map(
    runtime.capabilities.map((capability) => [capability.id, capability.status] as const),
  );

  return SESSION_EVENT_CAPABILITY_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    status: statusById.get(spec.id) ?? "unsupported",
  }));
}
