import { AGENT_KIND_RUNTIME_POLICIES } from "@mosoo/contracts/agent";
import type {
  AgentKind,
  AgentRuntimeNativeResumePersistence,
  AgentRuntimeSubjectScope,
  AgentRuntimeTerminalTarget,
} from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import { SANDBOX_MEMORY_PATH } from "agent-driver/paths";

export type RuntimeSubjectScope = AgentRuntimeSubjectScope;
export type RuntimeCheckpointRule =
  | {
      readonly path: typeof SANDBOX_MEMORY_PATH;
      readonly type: "subject_memory";
      readonly updateSubjectCheckpoint: true;
    }
  | {
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
export type RuntimeNativeResumePersistence = AgentRuntimeNativeResumePersistence;
export type RuntimePolicySubjectKind = Extract<SandboxSubjectKind, "agent" | "session">;
export type RuntimeTerminalTargetPolicy = AgentRuntimeTerminalTarget;

export interface RuntimeKindPolicy {
  readonly checkpoint: {
    readonly clearOnReset: readonly RuntimeStateClearRule[];
    readonly createOnHibernate: readonly RuntimeCheckpointRule[];
    readonly createOnRecreate: readonly RuntimeCheckpointRule[];
    readonly createOnReset: readonly RuntimeCheckpointRule[];
    readonly restoreOnActivate: readonly RuntimeCheckpointRule[];
  };
  readonly kind: AgentKind;
  readonly lease: {
    readonly closeOnRunTerminal: boolean;
  };
  readonly nativeResume: {
    readonly persistence: RuntimeNativeResumePersistence;
  };
  readonly operations: {
    readonly recreateSubject: boolean;
    readonly resetSubjectState: boolean;
    readonly restartDriver: boolean;
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
// container boot (measured 2.4-4.8s vs ~0.3s on a warm container). A short
// idle grace keeps the sandbox alive between turns while the kind-agnostic
// inactive-deadline sweep still reclaims it shortly after the session goes
// quiet. Cost ceiling: one extra <=90s of container residency per session
// after its last run.
const CATTLE_SUBJECT_IDLE_GRACE_MS = 90_000;

const SUBJECT_MEMORY_CHECKPOINT = {
  path: SANDBOX_MEMORY_PATH,
  type: "subject_memory",
  updateSubjectCheckpoint: true,
} as const satisfies RuntimeCheckpointRule;

const SESSION_WORKSPACES_CHECKPOINT = {
  type: "session_workspaces",
  updateSubjectCheckpoint: false,
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
      restoreOnActivate: [],
    },
    kind: "cattle",
    lease: {
      closeOnRunTerminal: true,
    },
    nativeResume: {
      persistence: AGENT_KIND_RUNTIME_POLICIES.cattle.nativeResume.persistence,
    },
    operations: {
      recreateSubject: AGENT_KIND_RUNTIME_POLICIES.cattle.operations.recreateSubject,
      resetSubjectState: AGENT_KIND_RUNTIME_POLICIES.cattle.operations.resetSubjectState,
      restartDriver: AGENT_KIND_RUNTIME_POLICIES.cattle.operations.restartDriver,
      terminalTarget: AGENT_KIND_RUNTIME_POLICIES.cattle.terminal.target,
    },
    subject: {
      idleReleaseDelayMs: CATTLE_SUBJECT_IDLE_GRACE_MS,
      scope: AGENT_KIND_RUNTIME_POLICIES.cattle.subject.scope,
      subjectKind: AGENT_KIND_RUNTIME_POLICIES.cattle.subject.scope,
    },
  },
  pet: {
    checkpoint: {
      clearOnReset: [SUBJECT_MEMORY_CLEAR, SESSION_RUNTIME_STATE_CLEAR],
      createOnHibernate: [SESSION_WORKSPACES_CHECKPOINT, SUBJECT_MEMORY_CHECKPOINT],
      createOnRecreate: [SESSION_WORKSPACES_CHECKPOINT, SUBJECT_MEMORY_CHECKPOINT],
      createOnReset: [SESSION_WORKSPACES_CHECKPOINT],
      restoreOnActivate: [SUBJECT_MEMORY_CHECKPOINT],
    },
    kind: "pet",
    lease: {
      closeOnRunTerminal: false,
    },
    nativeResume: {
      persistence: AGENT_KIND_RUNTIME_POLICIES.pet.nativeResume.persistence,
    },
    operations: {
      recreateSubject: AGENT_KIND_RUNTIME_POLICIES.pet.operations.recreateSubject,
      resetSubjectState: AGENT_KIND_RUNTIME_POLICIES.pet.operations.resetSubjectState,
      restartDriver: AGENT_KIND_RUNTIME_POLICIES.pet.operations.restartDriver,
      terminalTarget: AGENT_KIND_RUNTIME_POLICIES.pet.terminal.target,
    },
    subject: {
      idleReleaseDelayMs: RUNTIME_SUBJECT_IDLE_GRACE_MS,
      scope: AGENT_KIND_RUNTIME_POLICIES.pet.subject.scope,
      subjectKind: AGENT_KIND_RUNTIME_POLICIES.pet.subject.scope,
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
