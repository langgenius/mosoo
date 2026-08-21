import type { AgentId, SessionId } from "@mosoo/id";

/**
 * The pinned Driver protocol requires Agent provenance even when Mosoo's Run
 * source is a Harness. Keep that temporary impedance mismatch in one place.
 * The value is a Session-scoped internal correlation id; no Agent row is
 * inserted and it is never exposed by the Run API.
 *
 * Removal is tracked by https://github.com/langgenius/mosoo-agent-driver/issues/118.
 */
export function toHarnessDriverCompatibilityAgentId(sessionId: SessionId): AgentId {
  return sessionId as unknown as AgentId;
}
