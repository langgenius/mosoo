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

type ArchiveEntry = [path: string, contentBytes: Uint8Array];

function toSkillPath(skillId: string): string {
  return skillId.endsWith("/") ? skillId : `${skillId}/`;
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
  const skillEntriesByPath = indexSkillEntries(agentPackage, entries);

  for (const skill of agentPackage.manifest.skills) {
    const skillPath = toSkillPath(skill.skillId);
    const skillEntries = skillEntriesByPath.get(skillPath) ?? [];

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

function indexSkillEntries(
  agentPackage: AgentPackage,
  entries: Record<string, Uint8Array>,
): ReadonlyMap<string, readonly ArchiveEntry[]> {
  const entriesBySkillPath = new Map<string, ArchiveEntry[]>();

  for (const skill of agentPackage.manifest.skills) {
    entriesBySkillPath.set(toSkillPath(skill.skillId), []);
  }

  if (entriesBySkillPath.size === 0) {
    return entriesBySkillPath;
  }

  for (const entry of Object.entries(entries)) {
    const [path, contentBytes] = entry;

    if (contentBytes.byteLength === 0) {
      continue;
    }

    let slashIndex = path.indexOf("/");

    while (slashIndex !== -1) {
      const matchingEntries = entriesBySkillPath.get(path.slice(0, slashIndex + 1));

      if (matchingEntries !== undefined) {
        matchingEntries.push(entry);
      }

      slashIndex = path.indexOf("/", slashIndex + 1);
    }
  }

  return entriesBySkillPath;
}
