import { createAgentPackageArchiveBytes } from "@mosoo/agent-package";
import { AGENT_PACKAGE_VERSION } from "@mosoo/contracts/agent-manifest";
import type {
  AgentPackage,
  AgentPackageAsset,
  AgentPackageExport,
} from "@mosoo/contracts/agent-manifest";
import {
  createAgentPackageFileName,
  createAgentPackageSkillPath,
  serializeAgentManifestToYaml,
} from "@mosoo/contracts/agent-manifest-serializer";
import type { AgentId } from "@mosoo/id";
import { unzipSync } from "fflate";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { appendSuccessfulControlOperationAuditEvent } from "../../control-operations/application/control-operation-outcome-audit.service";
import { getFileRecordById } from "../../files/application/file-record-read.service";
import { readSkillPackageBytesFromSnapshot } from "../../skills/application/skill-package-snapshot.service";
import { ensureAgentPackageAccess } from "./agent-access.service";
import { readFileAssetContentText } from "./agent-package-assets.service";
import { createAgentPackageFile } from "./agent-package-file.service";
import { readFileId } from "./agent-platform-ids";
import { buildAgentSpec, toAgentManifest } from "./agent-spec.service";
import type { AgentSpecSkill } from "./agent-spec.service";

export function createPortableAgentPackageManifest(
  sourceManifest: AgentPackage["manifest"],
): AgentPackage["manifest"] {
  return {
    ...sourceManifest,
    agentsMd: sourceManifest.agentsMd
      ? {
          ...sourceManifest.agentsMd,
          assetId: null,
          assetKey: "attachments/AGENTS.md",
          filename: "AGENTS.md",
        }
      : null,
    environment: {
      ...sourceManifest.environment,
      environmentId: null,
      envVars: Object.fromEntries(
        Object.keys(sourceManifest.environment.envVars).map((secretName) => [secretName, ""]),
      ),
    },
    mcpServers: sourceManifest.mcpServers.map((server) => ({
      ...server,
      serverId: null,
    })),
    skills: sourceManifest.skills.map((skill) => ({
      ...skill,
      skillId:
        skill.skillId.startsWith("skills/") && skill.skillId.endsWith("/")
          ? skill.skillId
          : createAgentPackageSkillPath(skill.skillName),
    })),
    spaces: sourceManifest.spaces.map((space) => ({
      ...space,
      spaceId: null,
    })),
  };
}

async function appendSkillPackageAssets(input: {
  assets: AgentPackageAsset[];
  bindings: ApiBindings;
  skills: AgentSpecSkill[];
}): Promise<void> {
  for (const skill of input.skills) {
    if (!isTruthy(skill.currentSnapshotId) || skill.state !== "active") {
      continue;
    }

    const skillPath = skill.packagePath ?? createAgentPackageSkillPath(skill.skillName);
    const skillArchiveBytes = await readSkillPackageBytesFromSnapshot(
      input.bindings,
      skill.currentSnapshotId,
    );
    const skillEntries = unzipSync(skillArchiveBytes);

    for (const [entryPath, contentBytes] of Object.entries(skillEntries)) {
      if (contentBytes.byteLength === 0) {
        continue;
      }

      input.assets.push({
        contentBytes,
        contentText: null,
        filename: entryPath,
        key: `${skillPath}${entryPath}`,
        mimeType: null,
        role: "skill_file",
        size: contentBytes.byteLength,
      });
    }
  }
}

export async function exportAgentPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  agentId: AgentId,
): Promise<AgentPackageExport> {
  const packageAccess = await ensureAgentPackageAccess(bindings.DB, viewer.id, agentId);
  const sourceSpec = await buildAgentSpec(bindings.DB, packageAccess.agent);
  const sourceManifest = toAgentManifest(sourceSpec);
  const manifest = createPortableAgentPackageManifest(sourceManifest);
  const assets: AgentPackageAsset[] = [];

  const agentsMdAsset = sourceManifest.agentsMd;

  if (agentsMdAsset?.assetId && manifest.agentsMd?.assetKey) {
    const file = await getFileRecordById(bindings.DB, readFileId(agentsMdAsset.assetId));
    const contentText = file ? await readFileAssetContentText(bindings, file) : null;

    if (file && contentText !== null) {
      assets.push({
        contentText,
        filename: "AGENTS.md",
        key: manifest.agentsMd.assetKey,
        mimeType: file.mime_type,
        role: "agents_md",
        size: file.size,
      });
    }
  }

  await appendSkillPackageAssets({
    assets,
    bindings,
    skills: sourceSpec.skills,
  });

  const agentPackage: AgentPackage = {
    author: null,
    app: {
      avatarAssetKey: null,
      description: packageAccess.agent.description,
      name: packageAccess.agent.name,
    },
    assets,
    exportedAt: toIsoString(Date.now()),
    license: null,
    manifest,
    packageVersion: AGENT_PACKAGE_VERSION,
    version: null,
  };
  const fileName = createAgentPackageFileName(packageAccess.agent.name);
  const archiveBytes = createAgentPackageArchiveBytes(agentPackage);
  const packageFile = await createAgentPackageFile({
    archiveBytes,
    bindings,
    fileName,
    organizationId: packageAccess.agent.organizationId,
    viewer,
  });

  await appendSuccessfulControlOperationAuditEvent(bindings.DB, {
    metadata: {
      assetCount: String(assets.length),
      fileId: packageFile.fileId,
      kind: "package_export",
      size: String(packageFile.size),
    },
    organizationId: packageAccess.agent.organizationId,
    operationName: "exportAgentPackage",
    resourceDisplay: packageAccess.agent.name,
    resourceId: packageAccess.agent.id,
    viewer,
  });

  return {
    agentId: packageAccess.agent.id,
    contentType: packageFile.contentType,
    fileId: packageFile.fileId,
    fileName: packageFile.fileName,
    manifestYaml: serializeAgentManifestToYaml(manifest),
    size: packageFile.size,
  };
}
