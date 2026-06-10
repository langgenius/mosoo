const STORAGE_KEY_PREFIX = "mosoo:agent-builder:initial-message:";

// Stale stashes are dropped so a message stashed during a failed first visit
// does not fire unexpectedly when the user returns much later.
const STASH_TTL_MS = 15 * 60 * 1000;

interface StashedInitialMessage {
  readonly message: string;
  readonly stashedAt: number;
}

// The creation flow stashes the user's first Builder message here before
// navigating to the editor; the Builder panel consumes it once its submit gate
// opens. Consume-then-clear keeps the auto-send idempotent under StrictMode.
export function stashAgentBuilderInitialMessage(agentId: string, message: string): void {
  const stash: StashedInitialMessage = { message, stashedAt: Date.now() };

  try {
    sessionStorage.setItem(STORAGE_KEY_PREFIX + agentId, JSON.stringify(stash));
  } catch {
    // Storage unavailable (private mode quota, disabled storage): the user
    // simply lands on an empty Builder thread.
  }
}

export function takeAgentBuilderInitialMessage(agentId: string): string | null {
  try {
    const key = STORAGE_KEY_PREFIX + agentId;
    const raw = sessionStorage.getItem(key);

    if (raw === null) {
      return null;
    }

    sessionStorage.removeItem(key);

    const stash: unknown = JSON.parse(raw);

    if (
      typeof stash !== "object" ||
      stash === null ||
      typeof (stash as StashedInitialMessage).message !== "string" ||
      typeof (stash as StashedInitialMessage).stashedAt !== "number"
    ) {
      return null;
    }

    const { message, stashedAt } = stash as StashedInitialMessage;

    return Date.now() - stashedAt > STASH_TTL_MS ? null : message;
  } catch {
    return null;
  }
}
