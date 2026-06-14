import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import { SPACE_NAME_PATTERN, SPACE_NAME_RULE_DESCRIPTION } from "@mosoo/contracts/space";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionId, SpaceId } from "@mosoo/id";
import { DRIVER_CONTROL_PORT_COUNT, DRIVER_CONTROL_PORT_MIN } from "agent-driver/boot";
import { getGlobalSpaceMountPath, getSessionAliasPath } from "agent-driver/paths";

import type { DriverAppAccessSnapshotOutput } from "./driver-snapshot";

export interface FrozenSandboxSpaceBinding {
  role: "admin" | "edit" | "read";
  spaceId: SpaceId;
  spaceName: string;
  type: "space";
}

export const SANDBOX_SPACE_ANCHOR_FILE_NAME = ".mosoo-space-anchor";

function xorUint32(left: number, right: number): number {
  let result = 0;
  let placeValue = 1;
  let remainingLeft = left;
  let remainingRight = right;

  for (let bitIndex = 0; bitIndex < 32; bitIndex += 1) {
    const leftBit = remainingLeft % 2;
    const rightBit = remainingRight % 2;

    if (leftBit !== rightBit) {
      result += placeValue;
    }

    remainingLeft = Math.floor(remainingLeft / 2);
    remainingRight = Math.floor(remainingRight / 2);
    placeValue *= 2;
  }

  return result;
}

export function getDriverControlPort(driverInstanceId: DriverInstanceId): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < driverInstanceId.length; index += 1) {
    hash = xorUint32(hash, driverInstanceId.codePointAt(index) ?? 0);
    const nextHash = Math.imul(hash, 16_777_619);
    hash = nextHash < 0 ? nextHash + 4_294_967_296 : nextHash;
  }

  return DRIVER_CONTROL_PORT_MIN + (hash % DRIVER_CONTROL_PORT_COUNT);
}

function enforceCanonicalSpaceName(spaceName: string): void {
  if (!SPACE_NAME_PATTERN.test(spaceName)) {
    throw new Error(`Space name must satisfy: ${SPACE_NAME_RULE_DESCRIPTION}.`);
  }
}

function enforceUniqueSpaceNames(bindings: FrozenSandboxSpaceBinding[]): void {
  const seen = new Set<string>();

  for (const binding of bindings) {
    enforceCanonicalSpaceName(binding.spaceName);

    if (seen.has(binding.spaceName)) {
      throw new Error(`Session space aliases contain duplicate name: ${binding.spaceName}.`);
    }

    seen.add(binding.spaceName);
  }
}

export function freezeSandboxSpaceBindings(input: {
  bindings: FrozenSandboxSpaceBinding[];
  sessionId: SessionId;
}): {
  spaceAliases: SpaceAliasBinding[];
  appAccessSnapshot: DriverAppAccessSnapshotOutput;
} {
  enforceUniqueSpaceNames(input.bindings);

  const spaceAliases: SpaceAliasBinding[] = input.bindings.map((binding) => ({
    aliasPath: getSessionAliasPath(input.sessionId, binding.spaceName),
    globalMountPath: getGlobalSpaceMountPath(binding.spaceId),
    spaceId: binding.spaceId,
    spaceName: binding.spaceName,
  }));
  const roleBySpaceId = new Map(input.bindings.map((binding) => [binding.spaceId, binding]));
  const entries: DriverAppAccessSnapshotOutput["entries"] = [];

  for (const alias of spaceAliases) {
    const binding = roleBySpaceId.get(alias.spaceId);

    if (!binding) {
      throw new Error(`Missing frozen sandbox binding for space ${alias.spaceId}.`);
    }

    entries.push({
      mountPath: alias.aliasPath,
      role: binding.role,
      spaceId: alias.spaceId,
      type: binding.type,
    });
    entries.push({
      mountPath: alias.globalMountPath,
      role: binding.role,
      spaceId: alias.spaceId,
      type: binding.type,
    });
  }

  return {
    appAccessSnapshot: { entries },
    spaceAliases,
  };
}

export function buildAppAccessSnapshotFromAliases(input: {
  currentSnapshot: DriverAppAccessSnapshotOutput;
  spaceAliases: SpaceAliasBinding[];
}): DriverAppAccessSnapshotOutput {
  const accessBySpaceId = new Map<
    SpaceId,
    {
      role: "admin" | "edit" | "read";
      type: "space";
    }
  >();

  for (const entry of input.currentSnapshot.entries) {
    const spaceId: SpaceId = parsePlatformId(entry.spaceId, "app access space id");

    if (!accessBySpaceId.has(spaceId)) {
      accessBySpaceId.set(spaceId, {
        role: entry.role,
        type: entry.type,
      });
    }
  }

  const entries: DriverAppAccessSnapshotOutput["entries"] = [];

  for (const alias of input.spaceAliases) {
    const access = accessBySpaceId.get(alias.spaceId);

    if (!access) {
      continue;
    }

    entries.push({
      mountPath: alias.aliasPath,
      role: access.role,
      spaceId: alias.spaceId,
      type: access.type,
    });
    entries.push({
      mountPath: alias.globalMountPath,
      role: access.role,
      spaceId: alias.spaceId,
      type: access.type,
    });
  }

  return { entries };
}
