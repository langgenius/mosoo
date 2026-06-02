import { parsePlatformId } from "@mosoo/id";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { notFoundError } from "../../../platform/errors";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type {
  AgentFileContent,
  AgentFileDownload,
  AgentFileTree,
} from "./agent-file-browser-model";
import { normalizeAgentFileBrowserPath } from "./agent-file-browser-path";
import {
  decodeSandboxBase64,
  getSandboxFileMetadata,
  isSandboxReadable,
  listSandboxDirectory,
  withReadableSandbox,
} from "./agent-file-browser-sandbox";
import { resolveAgentFileBrowserTarget } from "./agent-file-browser-target.service";
import {
  emptyAgentFileTree,
  ensureAgentFilePathAdmission,
  finalizeAgentFileEntries,
  listVirtualTreeEntries,
} from "./agent-file-browser-virtual-tree";

export async function getAgentFileTree(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: string;
    path: string;
  },
): Promise<AgentFileTree> {
  const path = normalizeAgentFileBrowserPath(input.path, "tree");
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer id");
  const target = await resolveAgentFileBrowserTarget(bindings.DB, viewer, input.agentId);
  const sandboxStatus = target.sandbox?.status ?? target.unavailableSandbox?.status ?? "missing";

  if (target.sandbox === null || !isSandboxReadable(sandboxStatus)) {
    return emptyAgentFileTree({
      agentId: target.agent.id,
      lastError: target.sandbox?.lastError ?? target.unavailableSandbox?.lastError ?? null,
      path,
      sandbox: target.sandbox,
      sandboxStatus,
    });
  }

  await ensureAgentFilePathAdmission(bindings.DB, {
    path,
    sandboxId: target.sandbox.id,
    viewerId,
  });

  const virtualListing = await listVirtualTreeEntries({
    database: bindings.DB,
    path,
    sandboxId: target.sandbox.id,
    viewerId,
  });
  const listing =
    virtualListing ??
    (await withReadableSandbox(bindings, target, async (handle) =>
      listSandboxDirectory(handle, path),
    ));

  return {
    agentId: target.agent.id,
    entries: finalizeAgentFileEntries(listing.entries),
    lastError: null,
    path,
    sandboxId: target.sandbox.id,
    sandboxStatus,
    totalCount: listing.totalCount,
    truncated: listing.truncated,
  };
}

export async function getAgentFileContent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: string;
    path: string;
  },
): Promise<AgentFileContent> {
  const path = normalizeAgentFileBrowserPath(input.path, "content");
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer id");
  const target = await resolveAgentFileBrowserTarget(bindings.DB, viewer, input.agentId);

  if (target.sandbox === null) {
    throw notFoundError("Agent sandbox is not available.");
  }

  await ensureAgentFilePathAdmission(bindings.DB, {
    path,
    sandboxId: target.sandbox.id,
    viewerId,
  });

  const sandboxId = target.sandbox.id;

  return withReadableSandbox(bindings, target, async (handle) => {
    const metadata = await getSandboxFileMetadata(handle, path);
    const content =
      metadata.preview === "text"
        ? (await handle.readFile(path, { encoding: "utf8" })).content
        : null;

    return {
      agentId: target.agent.id,
      content,
      mimeType: metadata.mimeType,
      name: metadata.name,
      path,
      preview: metadata.preview,
      sandboxId,
      sizeBytes: metadata.sizeBytes,
    };
  });
}

export async function downloadAgentFile(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    agentId: string;
    path: string;
  },
): Promise<AgentFileDownload> {
  const path = normalizeAgentFileBrowserPath(input.path, "content");
  const viewerId = parsePlatformId<AccountId>(viewer.id, "viewer id");
  const target = await resolveAgentFileBrowserTarget(bindings.DB, viewer, input.agentId);

  if (target.sandbox === null) {
    throw notFoundError("Agent sandbox is not available.");
  }

  await ensureAgentFilePathAdmission(bindings.DB, {
    path,
    sandboxId: target.sandbox.id,
    viewerId,
  });

  return withReadableSandbox(bindings, target, async (handle) => {
    const metadata = await getSandboxFileMetadata(handle, path);
    const file = await handle.readFile(path, { encoding: "base64" });
    const bytes =
      file.encoding === "base64"
        ? decodeSandboxBase64(file.content)
        : new TextEncoder().encode(file.content);

    return {
      bytes,
      fileName: metadata.name,
      mimeType: metadata.mimeType,
    };
  });
}
