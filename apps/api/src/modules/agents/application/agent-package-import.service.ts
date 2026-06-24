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
import { ensureAppOwnership } from "../../apps/application/app.service";
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
} from "./agent-package-resolution.service";
import { readFileId, readAppId } from "./agent-platform-ids";
import { assertRuntimeAdvancedSettings } from "./runtime-advanced-settings-validation.service";
export async function importAgentPackage(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ImportAgentPackageInput,
): Promise<AgentPackageImportResult<Agent>> {
  const fileId = readFileId(input.fileId, "Agent package file ID");
  const app = await ensureAppOwnership(bindings.DB, viewer.id, readAppId(input.appId));
  const packageFile = await readAgentPackageArchiveFile({
    bindings,
    fileId,
    appId: app.id,
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
    runtimeId: manifest.runtime.id,
    settings: manifest.runtime.providerOptions,
  });
  issues.push(...collectPackageDeclarationIssues(parsed.package));
  issues.push(...(await collectRuntimeResolutionIssues(bindings.DB, viewer.id, app.id, manifest)));

  const [skillResolution, environmentId, mcpServerIds] = await Promise.all([
    resolvePackageSkills({
      bindings,
      database: bindings.DB,
      issues,
      manifest,
      packageAssets: parsed.package.assets,
      appId: app.id,
      summary,
      viewer,
      viewerId: viewer.id,
    }),
    resolvePackageEnvironment({
      allowTargetNameMatch: false,
      appId: app.id,
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
    agentName: parsed.package.app.name,
    description: parsed.package.app.description,
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
    appId: app.id,
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
