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
  for (const skill of agentPackage.manifest.skills) {
    const skillPath = skill.skillId.endsWith("/") ? skill.skillId : `${skill.skillId}/`;
    const skillEntries = Object.entries(entries).filter(
      ([path, entry]) => path.startsWith(skillPath) && entry.byteLength > 0,
    );

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
