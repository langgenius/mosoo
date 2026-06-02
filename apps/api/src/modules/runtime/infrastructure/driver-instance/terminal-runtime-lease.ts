import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getRuntimeKindPolicy } from "../../domain/runtime-kind-policy";
import { recycleInactiveRuntimeSubjectNow } from "../runtime-subject-lifecycle/runtime-subject-recycle.service";
import { closeSandboxConversationSession } from "../sandbox-session.service";
import type { RuntimeSessionLink } from "./event-types";

export async function closeReleasedTerminalRuntimeLeaseIfNeeded(
  bindings: ApiBindings,
  input: {
    readonly link: RuntimeSessionLink | null;
    readonly released: boolean;
  },
): Promise<void> {
  if (!input.released || input.link === null) {
    return;
  }

  await closeTerminalRuntimeConversationIfNeeded(bindings, input.link);
  await recycleReleasedTerminalRuntimeLeaseIfNeeded(bindings, input);
}

export async function closeTerminalRuntimeConversationIfNeeded(
  bindings: ApiBindings,
  link: RuntimeSessionLink,
): Promise<void> {
  if (link.sandboxKind === null || link.sandboxId === null || link.sessionId === null) {
    return;
  }

  const policy = getRuntimeKindPolicy(link.sandboxKind);

  if (!policy.lease.closeOnRunTerminal) {
    return;
  }

  await closeSandboxConversationSession(bindings, {
    sandboxId: link.sandboxId,
    sessionId: link.sessionId,
  });
}

export async function recycleReleasedTerminalRuntimeLeaseIfNeeded(
  bindings: ApiBindings,
  input: {
    readonly link: RuntimeSessionLink | null;
    readonly released: boolean;
  },
): Promise<void> {
  if (!input.released || input.link === null) {
    return;
  }

  const link = input.link;

  if (link.sandboxKind === null || link.sandboxId === null || link.sessionId === null) {
    return;
  }

  const policy = getRuntimeKindPolicy(link.sandboxKind);

  if (policy.subject.idleReleaseDelayMs !== 0) {
    return;
  }

  try {
    await recycleInactiveRuntimeSubjectNow(bindings, {
      kind: link.sandboxKind,
      reason: "runtime_subject.terminal_release",
      runtimeSubjectId: link.sandboxId,
    });
  } catch (error) {
    logWarn("runtime.subject.terminal_release.recycle_failed", {
      ...createErrorLogContext(error),
      runtimeSubjectId: link.sandboxId,
      sessionId: link.sessionId,
    });
  }
}
