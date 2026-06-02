import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { AgentId, PlatformId, SessionId } from "@mosoo/id";

import { getRuntimeKindPolicy } from "./runtime-kind-policy";

export interface RuntimeSandboxSubject {
  kind: AgentKind;
  subjectId: PlatformId;
  subjectKind: SandboxSubjectKind;
}

export function resolveStableAgentRuntimeSubject(input: {
  agentId: AgentId;
  kind: AgentKind;
}): RuntimeSandboxSubject {
  const policy = getRuntimeKindPolicy(input.kind);

  if (policy.subject.scope !== "agent") {
    throw new Error("Runtime kind does not use a stable agent subject.");
  }

  return toRuntimeSandboxSubject({
    kind: input.kind,
    subjectId: input.agentId,
    subjectKind: policy.subject.subjectKind,
  });
}

export function resolveAgentRuntimeSandboxSubject(input: {
  agentId: AgentId;
  kind: AgentKind;
  sessionId: SessionId;
}): RuntimeSandboxSubject {
  const policy = getRuntimeKindPolicy(input.kind);

  return toRuntimeSandboxSubject({
    kind: input.kind,
    subjectId: policy.subject.scope === "agent" ? input.agentId : input.sessionId,
    subjectKind: policy.subject.subjectKind,
  });
}

function toRuntimeSandboxSubject(input: {
  kind: AgentKind;
  subjectId: PlatformId;
  subjectKind: SandboxSubjectKind;
}): RuntimeSandboxSubject {
  return {
    kind: input.kind,
    subjectId: input.subjectId,
    subjectKind: input.subjectKind,
  };
}
