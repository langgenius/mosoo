import type {
  AgentPackage,
  AgentPackageAsset,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";

import { PACKAGE_CONTENT_TEXT_LIMIT_BYTES } from "./archive-constants";
import { createArchiveIssue } from "./archive-issue";

interface PackageAssetReadResult {
  assets: AgentPackageAsset[];
  issues: AgentResolutionIssue[];
}

interface SkillAssetBucket {
  entries: Array<[path: string, contentBytes: Uint8Array]>;
  skill: AgentPackage["manifest"]["skills"][number];
  skillPath: string;
}

export function readPackageAssets(
  agentPackage: AgentPackage,
  entries: Record<string, Uint8Array>,
): PackageAssetReadResult {
  const assets: AgentPackageAsset[] = [];
  const issues: AgentResolutionIssue[] = [];

  readSkillAssets(agentPackage, entries, assets, issues);

  return { assets, issues };
}

function readSkillAssets(
  agentPackage: AgentPackage,
  entries: Record<string, Uint8Array>,
  assets: AgentPackageAsset[],
  issues: AgentResolutionIssue[],
): void {
  for (const { entries: skillEntries, skill, skillPath } of collectSkillAssetBuckets(
    agentPackage,
    entries,
  )) {
    if (skillEntries.length === 0) {
      issues.push(
        createArchiveIssue({
          code: "package.skill.missing",
          message: `Package manifest references missing skill directory ${skillPath}.`,
          status: "missing",
          targetLabel: skill.skillName,
          targetType: "skill",
        }),
      );
      continue;
    }

    for (const [path, contentBytes] of skillEntries) {
      if (contentBytes.byteLength > PACKAGE_CONTENT_TEXT_LIMIT_BYTES) {
        issues.push(
          createArchiveIssue({
            code: "package.skill.invalid",
            message: `Package skill file ${path} exceeds the 2 MB per-file limit.`,
            status: "unsupported",
            targetLabel: path,
            targetType: "skill",
          }),
        );
        continue;
      }

      assets.push({
        contentBytes,
        contentText: null,
        filename: path.slice(skillPath.length),
        key: path,
        mimeType: null,
        role: "skill_file",
        size: contentBytes.byteLength,
      });
    }
  }
}

function collectSkillAssetBuckets(
  agentPackage: AgentPackage,
  entries: Record<string, Uint8Array>,
): SkillAssetBucket[] {
  const buckets: SkillAssetBucket[] = agentPackage.manifest.skills.map((skill) => ({
    entries: [],
    skill,
    skillPath: skill.skillId.endsWith("/") ? skill.skillId : `${skill.skillId}/`,
  }));

  if (buckets.length === 0) {
    return buckets;
  }

  const archiveEntries = Object.entries(entries);

  if (buckets.length === 1) {
    const [bucket] = buckets;

    if (bucket !== undefined) {
      bucket.entries = archiveEntries.filter(
        ([path, contentBytes]) => contentBytes.byteLength > 0 && path.startsWith(bucket.skillPath),
      );
    }

    return buckets;
  }

  const entriesBySkillPath = new Map<string, SkillAssetBucket["entries"]>();

  for (const bucket of buckets) {
    if (!entriesBySkillPath.has(bucket.skillPath)) {
      entriesBySkillPath.set(bucket.skillPath, []);
    }
  }

  for (const [path, contentBytes] of archiveEntries) {
    if (contentBytes.byteLength === 0) {
      continue;
    }

    // Probe directory prefixes once per entry so overlapping and duplicate
    // skill declarations keep their existing matching behavior.
    let slashIndex = path.indexOf("/");

    while (slashIndex !== -1) {
      const candidateRoot = path.slice(0, slashIndex + 1);
      const matchingEntries = entriesBySkillPath.get(candidateRoot);

      if (matchingEntries !== undefined) {
        matchingEntries.push([path, contentBytes]);
      }

      slashIndex = path.indexOf("/", slashIndex + 1);
    }
  }

  for (const bucket of buckets) {
    bucket.entries = entriesBySkillPath.get(bucket.skillPath) ?? [];
  }

  return buckets;
}
