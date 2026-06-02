import type { RuntimeDriverRunTransition } from "./event-types";

export function hasTerminalRuntimeDriverRunTransition(
  transitions: readonly RuntimeDriverRunTransition[],
): boolean {
  return transitions.some(
    (transition) =>
      transition.status === "cancelled" ||
      transition.status === "completed" ||
      transition.status === "failed",
  );
}
