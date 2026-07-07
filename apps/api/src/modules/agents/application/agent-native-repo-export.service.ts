import { createAgentPackageArchiveBytes } from "@mosoo/agent-package";
import type { AgentPackageExport } from "@mosoo/contracts/agent-manifest";
import {
  createAgentPackageFileName,
  serializeAgentManifestToYaml,
} from "@mosoo/contracts/agent-manifest-serializer";
import type { AgentId } from "@mosoo/id";
import { unzipSync, zipSync } from "fflate";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { buildPortableAgentPackage } from "./agent-package-export.service";
import { createAgentNativeRepoFile } from "./agent-package-file.service";

const MOSOO_NATIVE_REPO_MARKER_PATH = ".mosoo.toml";
const MOSOO_NATIVE_REPO_MARKER_CONTENT = 'spec = "mosoo.spec.v1"\n';
const NATIVE_AGENT_ENTRY_PREFIX = ".agent/";

const textEncoder = new TextEncoder();

function createAgentNativeRepoFileName(agentName: string): string {
  const packageFileName = createAgentPackageFileName(agentName);
  const stem = packageFileName.endsWith(".agent")
    ? packageFileName.slice(0, -".agent".length)
    : packageFileName;

  return `${stem || "agent"}-native.zip`;
}

function createNativeRepoArchiveBytes(
  agentPackage: Parameters<typeof createAgentPackageArchiveBytes>[0],
) {
  const packageArchiveBytes = createAgentPackageArchiveBytes(agentPackage);
  const packageEntries = unzipSync(packageArchiveBytes);
  const nativeEntries: Record<string, Uint8Array> = {
    [MOSOO_NATIVE_REPO_MARKER_PATH]: textEncoder.encode(MOSOO_NATIVE_REPO_MARKER_CONTENT),
  };

  for (const [path, bytes] of Object.entries(packageEntries)) {
    nativeEntries[`${NATIVE_AGENT_ENTRY_PREFIX}${path}`] = bytes;
  }

  return zipSync(nativeEntries);
}

export async function exportAgentNativeRepo(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: AgentId;
  },
): Promise<AgentPackageExport> {
  const portable = await buildPortableAgentPackage(bindings, viewer, input);
  const archiveBytes = createNativeRepoArchiveBytes(portable.agentPackage);
  const packageFile = await createAgentNativeRepoFile({
    archiveBytes,
    bindings,
    fileName: createAgentNativeRepoFileName(portable.agent.name),
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
