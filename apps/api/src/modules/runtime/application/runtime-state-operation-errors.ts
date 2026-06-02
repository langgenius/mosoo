import type { RunError } from "@mosoo/contracts/session-run";

export const RUNTIME_STATE_OPERATION_INTERRUPTED_ERROR: RunError = {
  code: "agent.runtime_state_operation",
  details: {},
  message: "Agent runtime operation interrupted the active run.",
  retryable: true,
};

export const RUNTIME_STATE_OPERATION_TIMEOUT_ERROR: RunError = {
  code: "agent.runtime_state_operation_timeout",
  details: {},
  message: "Agent runtime operation exceeded the reconnect window.",
  retryable: true,
};
