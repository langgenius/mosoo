import type { UserWarning } from "@mosoo/contracts/session-run";
import type { ResolvedRunSkill } from "@mosoo/contracts/skill";
import type { AppId, SkillSnapshotId } from "@mosoo/id";

import { isPackageSkillRuntimeId } from "../../../agents/application/agent-stored-config.service";
import { listSkillSnapshotsByIds } from "../../../skills/application/skill-package-snapshot.service";
import type { LoadedSkillSnapshotRow } from "../../../skills/application/skill-package-snapshot.service";
import type { DriverSkillCatalogEntry } from "../../domain/driver-snapshot";
import type { SessionExecutionPlan } from "./session-execution.types";

export interface ResolvedSessionSkillReference {
  skill: Omit<ResolvedRunSkill, "downloadUrl">;
  skillCatalogEntry: DriverSkillCatalogEntry;
  warnings: UserWarning[];
}

type SessionSkillReference = SessionExecutionPlan["skills"][number];

function createTombstoneSessionSkillReference(input: {
  message: string;
  mountPath: string;
  skillReference: SessionSkillReference;
}): ResolvedSessionSkillReference {
  return {
    skill: {
      archiveFormat: "zip",
      blobSha256: "tombstone",
      compression: "deflate",
      materializationStatus: "skipped",
      mountPath: input.mountPath,
      resolutionMode: "tombstone",
      skillId: input.skillReference.skillId,
      skillName: input.skillReference.skillName,
      snapshotId: null,
      warningCode: "skill.tombstone",
    },
    skillCatalogEntry: {
      frontmatter: {
        author: null,
        description: null,
        version: null,
      },
      mountPath: input.mountPath,
      resolutionMode: "tombstone",
      skillId: input.skillReference.skillId,
      skillName: input.skillReference.skillName,
    },
    warnings: [
      {
        code: "skill.tombstone",
        message: input.message,
      },
    ],
  };
}

function createResolvedSessionSkillReference(input: {
  mountPath: string;
  skillReference: SessionSkillReference;
  snapshot: LoadedSkillSnapshotRow;
}): ResolvedSessionSkillReference {
  return {
    skill: {
      archiveFormat: "zip",
      blobSha256: input.snapshot.blobSha256,
      compression: "deflate",
      materializationStatus: "pending",
      mountPath: input.mountPath,
      resolutionMode: input.skillReference.resolutionMode,
      skillId: input.skillReference.skillId,
      skillName: input.skillReference.skillName,
      snapshotId: input.snapshot.id,
      warningCode: null,
    },
    skillCatalogEntry: {
      frontmatter: {
        author: input.snapshot.author,
        description: input.snapshot.description,
        version: input.snapshot.version,
      },
      mountPath: input.mountPath,
      resolutionMode: input.skillReference.resolutionMode,
      skillId: input.skillReference.skillId,
      skillName: input.skillReference.skillName,
    },
    warnings: [],
  };
}

function getResolvableSnapshotIds(
  skillReferences: readonly SessionSkillReference[],
): SkillSnapshotId[] {
  return skillReferences.flatMap((skillReference) =>
    skillReference.resolutionMode === "tombstone" || skillReference.snapshotId === null
      ? []
      : [skillReference.snapshotId],
  );
}

export async function resolveSessionSkillReferences(input: {
  database: D1Database;
  sessionAppId: AppId;
  skillMountRoot: string;
  skillReferences: readonly SessionSkillReference[];
}): Promise<ResolvedSessionSkillReference[]> {
  const snapshotsById = await listSkillSnapshotsByIds(
    input.database,
    getResolvableSnapshotIds(input.skillReferences),
  );

  return input.skillReferences.map((skillReference) => {
    const mountPath = `${input.skillMountRoot}/${skillReference.skillId}`;
    const snapshotId = skillReference.snapshotId;
    const isPackageSkill = isPackageSkillRuntimeId(skillReference.skillId);

    if (skillReference.resolutionMode === "tombstone" || snapshotId === null) {
      return createTombstoneSessionSkillReference({
        message: `${skillReference.skillName} is unavailable and was skipped.`,
        mountPath,
        skillReference,
      });
    }

    const snapshot = snapshotsById.get(snapshotId);

    if (snapshot === undefined) {
      if (isPackageSkill) {
        return createTombstoneSessionSkillReference({
          message: `${skillReference.skillName} is unavailable and was skipped.`,
          mountPath,
          skillReference,
        });
      }

      throw new Error("Skill snapshot not found.");
    }

    if (snapshot.appId !== input.sessionAppId) {
      if (isPackageSkill) {
        throw new Error("Package-owned skill snapshot belongs to another App.");
      }

      throw new Error("Skill snapshot belongs to another App.");
    }

    return createResolvedSessionSkillReference({
      mountPath,
      skillReference,
      snapshot,
    });
  });
}
