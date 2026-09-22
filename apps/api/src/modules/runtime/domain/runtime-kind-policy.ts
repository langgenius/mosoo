import { SANDBOX_MEMORY_PATH } from "@mosoo/agent-driver/paths";
import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";

// Private rollback compatibility for legacy stored subjects, not an Agent configuration field.
export type RuntimeSubjectScope = "agent" | "session";
export type RuntimeCheckpointRule =
  | {
      readonly path: typeof SANDBOX_MEMORY_PATH;
      readonly type: "subject_memory";
      readonly updateSubjectCheckpoint: true;
    }
  | {
      readonly sanitizeTransientState: boolean;
      readonly type: "session_workspaces";
      readonly updateSubjectCheckpoint: false;
    };
export type RuntimeStateClearRule =
  | {
      readonly path: typeof SANDBOX_MEMORY_PATH;
      readonly type: "subject_memory";
    }
  | {
      readonly type: "session_runtime_state";
    };
export type RuntimePolicySubjectKind = Extract<SandboxSubjectKind, "agent" | "session">;
export type RuntimeTerminalTargetPolicy = "unavailable" | "stable_subject";

export interface RuntimeKindPolicy {
  readonly checkpoint: {
    readonly clearOnReset: readonly RuntimeStateClearRule[];
    readonly createOnHibernate: readonly RuntimeCheckpointRule[];
    readonly createOnRecreate: readonly RuntimeCheckpointRule[];
    readonly createOnReset: readonly RuntimeCheckpointRule[];
    readonly createOnTerminal: readonly RuntimeCheckpointRule[];
    readonly restoreOnActivate: readonly RuntimeCheckpointRule[];
  };
  readonly kind: AgentKind;
  readonly operations: {
    readonly resetSubjectState: boolean;
    readonly terminalTarget: RuntimeTerminalTargetPolicy;
  };
  readonly subject: {
    readonly idleReleaseDelayMs: number;
    readonly scope: RuntimeSubjectScope;
    readonly subjectKind: RuntimePolicySubjectKind;
  };
}

const RUNTIME_SUBJECT_IDLE_GRACE_MS = 5 * 60_000;

// Cattle subjects are per-session sandboxes; tearing them down after every
// terminal run made each follow-up turn in the same session pay the full
// container boot (measured 2.4-4.8s vs ~0.3s on a warm container). The idle
// grace keeps the sandbox — and, since conversations no longer close on run
// terminal, the resident driver — alive between turns while the
// kind-agnostic inactive-deadline sweep still reclaims it after the session
// goes quiet. Five minutes matches the human read-think-type rhythm between
// follow-up turns (90s covered only a third of observed gaps) and the pet
// grace. Cost: the grace applies twice in series — the sweep waits it out as
// the idle threshold, then the close arms the same grace as the subject's
// inactive deadline — so worst-case container residency after the last run is
// ~2x the grace (~10min), not one grace. Acceptable at current cattle volume;
// shorten the post-close deadline for sweep-closes if that residency matters.
const CATTLE_SUBJECT_IDLE_GRACE_MS = 5 * 60_000;

const SUBJECT_MEMORY_CHECKPOINT = {
  path: SANDBOX_MEMORY_PATH,
  type: "subject_memory",
  updateSubjectCheckpoint: true,
} as const satisfies RuntimeCheckpointRule;

const SESSION_WORKSPACES_CHECKPOINT = {
  sanitizeTransientState: false,
  type: "session_workspaces",
  updateSubjectCheckpoint: false,
} as const satisfies RuntimeCheckpointRule;

const CATTLE_SESSION_WORKSPACE_CHECKPOINT = {
  ...SESSION_WORKSPACES_CHECKPOINT,
  sanitizeTransientState: true,
} as const satisfies RuntimeCheckpointRule;

const SUBJECT_MEMORY_CLEAR = {
  path: SANDBOX_MEMORY_PATH,
  type: "subject_memory",
} as const satisfies RuntimeStateClearRule;

const SESSION_RUNTIME_STATE_CLEAR = {
  type: "session_runtime_state",
} as const satisfies RuntimeStateClearRule;

export const RUNTIME_KIND_POLICIES = {
  cattle: {
    checkpoint: {
      clearOnReset: [],
      createOnHibernate: [],
      createOnRecreate: [],
      createOnReset: [],
      createOnTerminal: [CATTLE_SESSION_WORKSPACE_CHECKPOINT],
      restoreOnActivate: [CATTLE_SESSION_WORKSPACE_CHECKPOINT],
    },
    kind: "cattle",
    operations: {
      resetSubjectState: false,
      terminalTarget: "unavailable",
    },
    subject: {
      idleReleaseDelayMs: CATTLE_SUBJECT_IDLE_GRACE_MS,
      scope: "session",
      subjectKind: "session",
    },
  },
  pet: {
    checkpoint: {
      clearOnReset: [SUBJECT_MEMORY_CLEAR, SESSION_RUNTIME_STATE_CLEAR],
      createOnHibernate: [SESSION_WORKSPACES_CHECKPOINT, SUBJECT_MEMORY_CHECKPOINT],
      createOnRecreate: [SESSION_WORKSPACES_CHECKPOINT, SUBJECT_MEMORY_CHECKPOINT],
      createOnReset: [SESSION_WORKSPACES_CHECKPOINT],
      createOnTerminal: [],
      restoreOnActivate: [SESSION_WORKSPACES_CHECKPOINT, SUBJECT_MEMORY_CHECKPOINT],
    },
    kind: "pet",
    operations: {
      resetSubjectState: true,
      terminalTarget: "stable_subject",
    },
    subject: {
      idleReleaseDelayMs: RUNTIME_SUBJECT_IDLE_GRACE_MS,
      scope: "agent",
      subjectKind: "agent",
    },
  },
} as const satisfies Record<AgentKind, RuntimeKindPolicy>;

export function getRuntimeKindPolicy(kind: AgentKind): RuntimeKindPolicy {
  return RUNTIME_KIND_POLICIES[kind];
}

export function getRuntimeSubjectInactiveDeadline(policy: RuntimeKindPolicy, now: number): number {
  return now + policy.subject.idleReleaseDelayMs;
}

export function runtimeCheckpointRulesInclude(
  rules: readonly RuntimeCheckpointRule[],
  type: RuntimeCheckpointRule["type"],
): boolean {
  return rules.some((rule) => rule.type === type);
}
