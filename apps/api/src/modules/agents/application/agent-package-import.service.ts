import {
  createEmptyResolutionSummary,
  createPackageResolutionState,
  createResolutionIssue,
  createResolutionReport,
  parseAgentPackageArchiveBytes,
} from "@mosoo/agent-package";
import type { Agent } from "@mosoo/contracts/agent";
import type {
  AgentPackageImportResult,
  ImportAgentPackageInput,
} from "@mosoo/contracts/agent-manifest";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { toAgentModel } from "./agent-models";
import { createDraftAgentBatch } from "./agent-package-draft.service";
import {
  cleanupPreparedAgentAssetFiles,
  deleteImportedAgentPackageFile,
  prepareAgentAssetFileFromPackage,
  readAgentPackageArchiveFile,
} from "./agent-package-file.service";
import type { PreparedAgentAssetFile } from "./agent-package-file.service";
import { resolvePackageMcpServers } from "./agent-package-mcp-resolution.service";
import {
  collectPackageDeclarationIssues,
  collectRuntimeResolutionIssues,
  readAgentPackageAsset,
  resolvePackageEnvironment,
  resolvePackageSkills,
  resolvePackageSpaces,
} from "./agent-package-resolution.service";
import { readFileId } from "./agent-platform-ids";
export async function importAgentPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ImportAgentPackageInput,
): Promise<AgentPackageImportResult<Agent>> {
  const fileId = readFileId(input.fileId, "Agent package file ID");
  const packageFile = await readAgentPackageArchiveFile({
    bindings,
    fileId,
    organizationId: input.organizationId,
    viewer,
  });
  const parsed = parseAgentPackageArchiveBytes(packageFile.archiveBytes);
  const summary = createEmptyResolutionSummary();
  const issues = [...parsed.issues];

  if (!parsed.package || !parsed.manifest) {
    throw new Error(issues.map((issue) => issue.message).join(" "));
  }

  const { manifest } = parsed;
  issues.push(...collectPackageDeclarationIssues(parsed.package));
  const agentsMdAsset = readAgentPackageAsset(parsed.package, manifest.agentsMd?.assetKey ?? null);
  const preparedAssetFiles: PreparedAgentAssetFile[] = [];
  let agent: Awaited<ReturnType<typeof createDraftAgentBatch>>;
  let resolution: ReturnType<typeof createResolutionReport>;

  try {
    const preparedAgentsFile = agentsMdAsset
      ? await prepareAgentAssetFileFromPackage({
          asset: agentsMdAsset,
          bindings,
          organizationId: input.organizationId,
          viewer,
        })
      : null;
    const agentsFileId = preparedAgentsFile?.fileId ?? null;

    if (preparedAgentsFile !== null) {
      preparedAssetFiles.push(preparedAgentsFile);
    }

    if (manifest.agentsMd && !isTruthy(agentsFileId)) {
      issues.push(
        createResolutionIssue({
          actionLabel: "Rebind AGENTS.md",
          code: "agent.import.agents_md.missing",
          message: "AGENTS.md asset is missing from the package or cannot be copied.",
          targetLabel: manifest.agentsMd.filename,
          targetType: "agents_md",
        }),
      );
    } else if (isTruthy(agentsFileId)) {
      summary.copiedAssetCount += 1;
    }

    issues.push(
      ...(await collectRuntimeResolutionIssues(
        bindings.DB,
        viewer.id,
        input.organizationId,
        manifest,
      )),
    );

    const [skillResolution, spaceIds, environmentId, mcpServerIds] = await Promise.all([
      resolvePackageSkills({
        bindings,
        database: bindings.DB,
        issues,
        manifest,
        organizationId: input.organizationId,
        packageAssets: parsed.package.assets,
        summary,
        viewer,
        viewerId: viewer.id,
      }),
      resolvePackageSpaces({
        allowTargetNameMatch: false,
        database: bindings.DB,
        issues,
        manifest,
        organizationId: input.organizationId,
        summary,
        viewerId: viewer.id,
      }),
      resolvePackageEnvironment({
        allowTargetNameMatch: false,
        database: bindings.DB,
        issues,
        manifest,
        organizationId: input.organizationId,
      }),
      resolvePackageMcpServers({
        issues,
        manifest,
        summary,
      }),
    ]);
    resolution = createResolutionReport(issues, summary);

    agent = await createDraftAgentBatch(bindings.DB, {
      agentName: parsed.package.app.name,
      agentsFileId,
      description: parsed.package.app.description,
      environmentId,
      fileRecords: preparedAssetFiles.map((file) => file.values),
      kind: manifest.kind,
      mcpServerIds,
      model: manifest.runtime.model,
      organizationId: input.organizationId,
      ownerId: viewer.id,
      packageMcpServers: manifest.mcpServers,
      packageResolution: createPackageResolutionState("import", resolution),
      packageSkills: skillResolution.packageSkills,
      prompt: manifest.prompts.system,
      provider: manifest.runtime.provider,
      runtimeId: manifest.runtime.id,
      skillIds: skillResolution.skillIds,
      spaceIds,
    });
  } catch (error) {
    await cleanupPreparedAgentAssetFiles(bindings, preparedAssetFiles);
    throw error;
  }

  await deleteImportedAgentPackageFile({
    bindings,
    fileId,
    viewer,
  });

  return {
    agent: await toAgentModel(bindings.DB, viewer, agent),
    resolution,
  };
}
