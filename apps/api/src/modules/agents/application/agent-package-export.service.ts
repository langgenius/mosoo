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
import type { AgentId, AppId } from "@mosoo/id";
import { unzipSync } from "fflate";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { readSkillPackageBytesFromSnapshot } from "../../skills/application/skill-package-snapshot.service";
import { ensureAgentOwner, ensureAppAgentOwner } from "./agent-access.service";
import { createAgentPackageFile } from "./agent-package-file.service";
import { buildAgentSpec, toAgentManifest } from "./agent-spec.service";
import type { AgentSpecSkill } from "./agent-spec.service";
import type { AgentRow } from "./agent-types";

export function createPortableAgentPackageManifest(
  sourceManifest: AgentPackage["manifest"],
): AgentPackage["manifest"] {
  return {
    ...sourceManifest,
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

export async function buildPortableAgentPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId?: AppId;
  },
): Promise<{
  agent: AgentRow;
  agentPackage: AgentPackage;
  manifest: AgentPackage["manifest"];
}> {
  const agent =
    input.appId === undefined
      ? await ensureAgentOwner(bindings.DB, viewer.id, input.agentId)
      : (
          await ensureAppAgentOwner(bindings.DB, viewer.id, {
            agentId: input.agentId,
            appId: input.appId,
          })
        ).agent;
  const sourceSpec = await buildAgentSpec(bindings.DB, agent);
  const sourceManifest = toAgentManifest(sourceSpec);
  const manifest = createPortableAgentPackageManifest(sourceManifest);
  const assets: AgentPackageAsset[] = [];

  await appendSkillPackageAssets({
    assets,
    bindings,
    skills: sourceSpec.skills,
  });

  return {
    agent,
    agentPackage: {
      author: null,
      app: {
        avatarAssetKey: null,
        description: agent.description,
        name: agent.name,
      },
      assets,
      exportedAt: toIsoString(Date.now()),
      license: null,
      manifest,
      packageVersion: AGENT_PACKAGE_VERSION,
      sourceAgentId: agent.id,
      version: null,
    },
    manifest,
  };
}

export async function exportAgentPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
    appId: AppId;
  },
): Promise<AgentPackageExport> {
  const portable = await buildPortableAgentPackage(bindings, viewer, input);
  const fileName = createAgentPackageFileName(portable.agent.name);
  const archiveBytes = createAgentPackageArchiveBytes(portable.agentPackage);
  const packageFile = await createAgentPackageFile({
    archiveBytes,
    bindings,
    fileName,
    appId: portable.agent.appId,
    viewer,
  });

  return {
    agentId: portable.agent.id,
    contentType: packageFile.contentType,
    fileId: packageFile.fileId,
    fileName: packageFile.fileName,
    manifestYaml: serializeAgentManifestToYaml(portable.manifest, portable.agent.id),
    size: packageFile.size,
  };
}
