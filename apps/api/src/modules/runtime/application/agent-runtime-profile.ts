import type { JsonObject } from "@mosoo/contracts";
import type { AgentKind, AgentReadiness } from "@mosoo/contracts/agent";
import type {
  AccountId,
  AgentId,
  AppId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SpaceId,
} from "@mosoo/id";
import { getSessionOrganizationPath, getSessionRuntimeStatePath } from "agent-driver/paths";

import {
  isSpaceRoleRankSufficient,
  listSpaceAccessRows,
  rankToSpaceRole,
} from "../../spaces/domain/space-access.policy";
import type {
  DriverConfigRevision,
  DriverAppAccessSnapshotOutput,
  DriverProfileConfig,
} from "../domain/driver-snapshot";
import { getSupportedRuntimeId } from "../domain/runtime-config";
import { resolveAgentRuntimeSandboxSubject } from "../domain/runtime-sandbox-subject";
import { freezeSandboxSpaceBindings } from "../domain/sandbox-layout";
import type { FrozenSandboxSpaceBinding } from "../domain/sandbox-layout";
export async function resolveAgentSpaceBindings(
  database: D1Database,
  permissionPrincipalUserId: AccountId,
  appId: AppId,
  boundSpaceIds: SpaceId[],
): Promise<FrozenSandboxSpaceBinding[]> {
  const access = await listSpaceAccessRows(
    database,
    permissionPrincipalUserId,
    appId,
    boundSpaceIds,
  );

  return boundSpaceIds.map((spaceId) => {
    const row = access.accessibleRowsById.get(spaceId);

    if (!access.existingSpaceIds.has(spaceId)) {
      throw new Error("Space not found.");
    }

    if (!row || !isSpaceRoleRankSufficient(row.role_rank, "read")) {
      throw new Error("Space not found.");
    }

    return {
      role: rankToSpaceRole(row.role_rank),
      spaceId,
      spaceName: row.name,
      type: "space",
    } satisfies FrozenSandboxSpaceBinding;
  });
}

export function createAgentRuntimeProfile(input: {
  agentId: AgentId;
  callerUserId: AccountId;
  configRevision: DriverConfigRevision;
  entrypoint?: "api" | "chat";
  envVars: Record<string, string>;
  executionOwnerUserId: AccountId;
  kind: AgentKind;
  model: string;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  readiness: AgentReadiness;
  runtimeId: string;
  sandboxId: SandboxId;
  sandboxSessionId: SandboxSessionId;
  sessionId: SessionId;
  setupScript: string;
  spaceBindings: FrozenSandboxSpaceBinding[];
}): {
  profile: DriverProfileConfig;
  appAccessSnapshot: DriverAppAccessSnapshotOutput;
} {
  const frozenBindings = freezeSandboxSpaceBindings({
    bindings: input.spaceBindings,
    sessionId: input.sessionId,
  });
  const runtimeId = getSupportedRuntimeId(input.runtimeId);

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${input.runtimeId}.`);
  }

  const sandboxSubject = resolveAgentRuntimeSandboxSubject(input);

  return {
    appAccessSnapshot: frozenBindings.appAccessSnapshot,
    profile: {
      agentId: input.agentId,
      configRevision: input.configRevision,
      envVarNames: Object.keys(input.envVars),
      envVars: input.envVars,
      kind: input.kind,
      model: input.model,
      prompt: input.prompt,
      provider: input.provider,
      providerOptions: input.providerOptions,
      readiness: input.readiness,
      runtimeId,
      sandbox: {
        id: input.sandboxId,
        kind: sandboxSubject.kind,
        subjectId: sandboxSubject.subjectId,
        subjectKind: sandboxSubject.subjectKind,
      },
      session: {
        sandboxSessionId: input.sandboxSessionId,
        homePath: getSessionRuntimeStatePath(input.sessionId, runtimeId),
        origin: {
          callerUserId: input.callerUserId,
          entrypoint: input.entrypoint ?? "chat",
          executionOwnerUserId: input.executionOwnerUserId,
          type: "agent",
        },
        sessionOrganizationPath: getSessionOrganizationPath(input.sessionId),
        spaceAliases: frozenBindings.spaceAliases,
      },
      setupScript: input.setupScript,
      sourceKind: "agent",
    },
  };
}
