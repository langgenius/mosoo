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
  const resolution = createResolutionReport(issues, summary);

  const agent = await createDraftAgentBatch(bindings.DB, {
    agentName: parsed.package.app.name,
    description: parsed.package.app.description,
    environmentId,
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
