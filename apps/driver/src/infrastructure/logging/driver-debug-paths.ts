import { createHash } from "node:crypto";

import {
  isSandboxGlobalSpacePath,
  isSandboxOrganizationPath,
  isSandboxSessionAliasPath,
  isSandboxSessionPath,
} from "@mosoo/driver-protocol";
import type {
  DriverBootPayload,
  DriverOrganizationAccessSnapshotOutput,
} from "@mosoo/driver-protocol";

type PathKind =
  | "global_space"
  | "other_absolute"
  | "relative_or_unknown"
  | "session_alias"
  | "session_organization"
  | "organization_other";

interface PathCollectionSummary {
  count: number;
  fingerprint?: string | null;
  kindCounts: Record<PathKind, number>;
}

const PATH_KINDS: PathKind[] = [
  "global_space",
  "session_alias",
  "session_organization",
  "organization_other",
  "other_absolute",
  "relative_or_unknown",
] as const;

function summarizeSpaceAliases(
  aliases: DriverBootPayload["execution"]["session"]["context"]["spaceAliases"],
): { count: number; fingerprint: string | null } {
  if (aliases.length === 0) {
    return {
      count: 0,
      fingerprint: null,
    };
  }

  return {
    count: aliases.length,
    fingerprint: digestText(
      JSON.stringify(
        aliases
          .map((alias) => ({
            aliasPath: alias.aliasPath,
            globalMountPath: alias.globalMountPath,
            spaceId: alias.spaceId,
            spaceName: alias.spaceName,
          }))
          .toSorted((left, right) => left.aliasPath.localeCompare(right.aliasPath)),
      ),
    ),
  };
}

function getPathKind(path: string): PathKind {
  if (isSandboxGlobalSpacePath(path)) {
    return "global_space";
  }

  if (isSandboxSessionAliasPath(path)) {
    return "session_alias";
  }

  if (isSandboxSessionPath(path)) {
    return "session_organization";
  }

  if (isSandboxOrganizationPath(path)) {
    return "organization_other";
  }

  if (path.startsWith("/")) {
    return "other_absolute";
  }

  return "relative_or_unknown";
}

export function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function summarizeTextDigest(
  value: string | null | undefined,
): { length: number; sha256: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  return {
    length: value.length,
    sha256: digestText(value),
  };
}

export function summarizePath(
  path: string | null | undefined,
): { kind: PathKind; sha256: string } | null {
  if (typeof path !== "string") {
    return null;
  }

  return {
    kind: getPathKind(path),
    sha256: digestText(path),
  };
}

export function summarizePathCollection(
  paths: readonly string[],
  options: {
    includeFingerprint?: boolean;
  } = {},
): PathCollectionSummary {
  const kindCounts = Object.fromEntries(PATH_KINDS.map((kind) => [kind, 0])) as Record<
    PathKind,
    number
  >;
  const uniquePaths = [...new Set(paths.filter((path) => path.length > 0))];

  for (const path of uniquePaths) {
    kindCounts[getPathKind(path)] += 1;
  }

  return {
    count: uniquePaths.length,
    ...(options.includeFingerprint === true
      ? {
          fingerprint:
            uniquePaths.length > 0 ? digestText([...uniquePaths].toSorted().join("\n")) : null,
        }
      : {}),
    kindCounts,
  };
}

export function summarizeOrganizationAccessSnapshot(
  snapshot: DriverOrganizationAccessSnapshotOutput,
): Record<string, unknown> {
  const roleCounts = {
    admin: 0,
    edit: 0,
    read: 0,
  };
  const typeCounts = {
    root: 0,
    space: 0,
  };

  for (const entry of snapshot.entries) {
    roleCounts[entry.role] += 1;
    typeCounts[entry.type] += 1;
  }

  return {
    entryCount: snapshot.entries.length,
    fingerprint:
      snapshot.entries.length > 0
        ? digestText(
            JSON.stringify(
              snapshot.entries
                .map((entry) => ({
                  mountPath: entry.mountPath,
                  role: entry.role,
                  spaceId: entry.spaceId,
                  type: entry.type,
                }))
                .toSorted((left, right) => left.mountPath.localeCompare(right.mountPath)),
            ),
          )
        : null,
    roleCounts,
    typeCounts,
  };
}

export function summarizeDriverBootPayload(payload: DriverBootPayload): Record<string, unknown> {
  const { session } = payload.execution;
  const { context } = session;

  return {
    driverControlPort: payload.driverControlPort,
    driverInstanceId: payload.driverInstanceId,
    execution: {
      additionalDirectories: summarizePathCollection(session.additionalDirectories, {
        includeFingerprint: true,
      }),
      configRevision: payload.execution.configRevision,
      cwd: summarizePath(session.cwd),
      envVarCount: Object.keys(payload.execution.environment.variables).length,
      mcpServerCount: session.mcpServers.length,
      profilePrompt: summarizeTextDigest(payload.execution.profilePrompt),
      readySkillCount: payload.execution.skills.filter((skill) => skill.snapshotId).length,
      sessionContext: {
        homePath: summarizePath(context.homePath),
        organizationAccess: summarizeOrganizationAccessSnapshot(context.organizationAccessSnapshot),
        origin: {
          entrypoint: context.origin.entrypoint,
          type: context.origin.type,
        },
        sessionOrganizationPath: summarizePath(context.sessionOrganizationPath),
        spaceAliases: summarizeSpaceAliases(context.spaceAliases),
      },
      skillCatalogCount: payload.execution.skillCatalog.length,
      skillCount: payload.execution.skills.length,
    },
    heartbeatIntervalMs: payload.heartbeatIntervalMs,
    protocolVersion: payload.protocolVersion,
    runtime: payload.runtime,
    sandboxId: payload.sandboxId,
  };
}
