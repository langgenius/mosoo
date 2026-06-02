import { parseSchemaValue } from "@mosoo/contracts/validation";

import { SessionLiveStateSchema } from "./ag-ui-session-schema";
import type { JsonPatchOperation, SessionLiveState } from "./live-state";
import { isRecord, touchSessionLiveState } from "./live-state.reducer-core";
import type { JsonObject } from "./live-state.reducer-core";

type PatchTarget = JsonObject | unknown[];

function parsePath(path: string): string[] {
  if (path === "") {
    return [];
  }

  return path
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function readPatchContainer(value: unknown, path: string): PatchTarget {
  if (isRecord(value) || Array.isArray(value)) {
    return value;
  }

  throw new Error(`JSON patch path does not resolve to an object: ${path}.`);
}

function readArrayContainer(target: unknown[], key: string, path: string): PatchTarget {
  const arrayIndex = Number(key);

  if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= target.length) {
    throw new Error(`Invalid JSON patch array index: ${key}.`);
  }

  return readPatchContainer(target[arrayIndex], path);
}

function readObjectContainer(
  target: JsonObject,
  key: string,
  patch: JsonPatchOperation,
): PatchTarget {
  const current = target[key];

  if (!isRecord(current) && !Array.isArray(current)) {
    if (patch.op === "remove") {
      return target;
    }

    target[key] = {};
  }

  return readPatchContainer(target[key], patch.path);
}

function resolvePatchTarget(
  root: JsonObject,
  patch: JsonPatchOperation,
  pathSegments: string[],
): PatchTarget {
  let target: PatchTarget = root;

  for (const key of pathSegments.slice(0, -1)) {
    target = Array.isArray(target)
      ? readArrayContainer(target, key, patch.path)
      : readObjectContainer(target, key, patch);
  }

  return target;
}

function applyArrayPatch(target: unknown[], key: string, patch: JsonPatchOperation): void {
  const arrayIndex = key === "-" ? target.length : Number(key);

  if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex > target.length) {
    throw new Error(`Invalid JSON patch array index: ${key}.`);
  }

  if (patch.op === "remove") {
    if (arrayIndex < target.length) {
      target.splice(arrayIndex, 1);
    }

    return;
  }

  if (patch.op === "replace" && arrayIndex < target.length) {
    target[arrayIndex] = patch.value;
    return;
  }

  target.splice(arrayIndex, 0, patch.value);
}

function applyObjectPatch(target: JsonObject, key: string, patch: JsonPatchOperation): void {
  if (patch.op === "remove") {
    Reflect.deleteProperty(target, key);
    return;
  }

  target[key] = patch.value;
}

function replaceRootState(root: SessionLiveState, patch: JsonPatchOperation): SessionLiveState {
  if (patch.op === "remove") {
    return root;
  }

  if (!isRecord(patch.value)) {
    throw new Error("State delta root replacement must be an object.");
  }

  return parseSchemaValue(SessionLiveStateSchema.onDeepUndeclaredKey("delete"), patch.value);
}

function cloneSessionState(root: SessionLiveState): unknown {
  // StructuredClone is not available in this runtime-neutral package's TS lib target.
  return JSON.parse(JSON.stringify(root));
}

export function applyJsonPatch(
  root: SessionLiveState,
  patches: JsonPatchOperation[],
): SessionLiveState {
  const cloned: unknown = cloneSessionState(root);

  if (!isRecord(cloned)) {
    throw new Error("Session live state clone must be an object.");
  }

  const next = cloned;

  for (const patch of patches) {
    const pathSegments = parsePath(patch.path);

    if (pathSegments.length === 0) {
      return replaceRootState(root, patch);
    }

    const lastKey = pathSegments.at(-1);

    if (lastKey === undefined) {
      continue;
    }

    const target = resolvePatchTarget(next, patch, pathSegments);

    if (Array.isArray(target)) {
      applyArrayPatch(target, lastKey, patch);
      continue;
    }

    applyObjectPatch(target, lastKey, patch);
  }

  return touchSessionLiveState(
    parseSchemaValue(SessionLiveStateSchema.onDeepUndeclaredKey("delete"), next),
  );
}
