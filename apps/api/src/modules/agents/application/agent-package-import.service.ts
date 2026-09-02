import {
  createEmptyResolutionSummary,
  createPackageResolutionState,
  createResolutionReport,
  parseAgentPackageArchiveBytes,
} from "@mosoo/agent-package";
import type { Agent } from "@mosoo/contracts/agent";
import type {
  AgentPackageImportResult,
  ImportAgentPackageInput,
} from "@mosoo/contracts/agent-manifest";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { toAgentModel } from "./agent-models";
import { createDraftAgentBatch } from "./agent-package-draft.service";
import {
  deleteImportedAgentPackageFile,
  readAgentPackageArchiveFile,
} from "./agent-package-file.service";
import { resolvePackageMcpServers } from "./agent-package-mcp-resolution.service";
import {
  collectPackageDeclarationIssues,
  collectRuntimeResolutionIssues,
  resolvePackageEnvironment,
  resolvePackageSkills,
} from "./agent-package-resolution.service";
import { readFileId, readProjectId } from "./agent-platform-ids";
import { assertRuntimeAdvancedSettings } from "./runtime-advanced-settings-validation.service";
export async function importAgentPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ImportAgentPackageInput,
): Promise<AgentPackageImportResult<Agent>> {
  const fileId = readFileId(input.fileId, "Agent package file ID");
  const project = await ensureProjectOwnership(
    bindings.DB,
    viewer.id,
    readProjectId(input.projectId),
  );
  const packageFile = await readAgentPackageArchiveFile({
    bindings,
    fileId,
    projectId: project.id,
    viewer,
  });
  const parsed = parseAgentPackageArchiveBytes(packageFile.archiveBytes);
  const summary = createEmptyResolutionSummary();
  const issues = [...parsed.issues];

  if (!parsed.package || !parsed.manifest) {
    throw new Error(issues.map((issue) => issue.message).join(" "));
  }

  const { manifest } = parsed;
  const providerOptions = assertRuntimeAdvancedSettings({
    modelId: manifest.runtime.model,
    runtimeId: manifest.runtime.id,
    settings: manifest.runtime.providerOptions,
  });
  issues.push(...collectPackageDeclarationIssues(parsed.package));
  issues.push(
    ...(await collectRuntimeResolutionIssues(bindings.DB, viewer.id, project.id, manifest)),
  );

  const [skillResolution, environmentId, mcpServerIds] = await Promise.all([
    resolvePackageSkills({
      bindings,
      database: bindings.DB,
      issues,
      manifest,
      packageAssets: parsed.package.assets,
      projectId: project.id,
      summary,
      viewer,
      viewerId: viewer.id,
    }),
    resolvePackageEnvironment({
      allowTargetNameMatch: false,
      projectId: project.id,
      database: bindings.DB,
      issues,
      manifest,
    }),
    resolvePackageMcpServers({
      issues,
      manifest,
      summary,
    }),
  ]);
  const resolution = createResolutionReport(issues, summary);

  const agent = await createDraftAgentBatch(bindings.DB, {
    agentName: parsed.package.project.name,
    builtInTools: manifest.builtInTools,
    description: parsed.package.project.description,
    environmentId,
    kind: manifest.kind,
    mcpServerIds,
    model: manifest.runtime.model,
    ownerId: viewer.id,
    packageMcpServers: manifest.mcpServers,
    packageResolution: createPackageResolutionState("import", resolution),
    packageSkills: skillResolution.packageSkills,
    prompt: manifest.prompts.system,
    provider: manifest.runtime.provider,
    providerOptions,
    projectId: project.id,
    runtimeId: manifest.runtime.id,
    skillIds: skillResolution.skillIds,
  });

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
