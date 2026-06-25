import { getParentPath } from "@mosoo/contracts/file";
import type {
  CreateFileUploadRequest,
  FileOwnerId,
  FileOwnerKind,
  FilePurpose,
  FileScopeId,
  FileScopeKind,
  FileSessionKind,
} from "@mosoo/contracts/file";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, FileId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createFileInvalidRequestError } from "./file-errors";
import {
  createAccountAvatarPath,
  createAttachmentPath,
  ensureLibraryFilePathHasExtension,
  normalizeFileName,
  normalizeLibraryFilePath,
} from "./file-paths";
import { ensureAppSessionFileAccess } from "./session-file-ownership";

type FileUploadTarget = CreateFileUploadRequest["target"];
type FileUploadTargetKind = FileUploadTarget["kind"];
type FileUploadTargetForKind<Kind extends FileUploadTargetKind> = Extract<
  FileUploadTarget,
  { kind: Kind }
>;

interface ResolveUploadTargetInput<Target extends FileUploadTarget = FileUploadTarget> {
  bindings: ApiBindings;
  fileId: FileId;
  target: Target;
  viewer: AuthenticatedViewer;
}

export interface FileUploadTargetContext {
  logicalPath: string;
  name: string;
  ownerId: FileOwnerId;
  ownerKind: FileOwnerKind;
  parentPath: string;
  scopeId: FileScopeId;
  scopeKind: FileScopeKind;
  sessionKind: FileSessionKind | null;
}

export interface FileScopeCapabilities {
  moveRename:
    | {
        enabled: true;
        eventName: string;
        normalizePath(path: string): string;
      }
    | {
        enabled: false;
      };
  pathLocks: boolean;
  versioning: boolean;
}

export interface FileScopeDescriptor {
  capabilities: FileScopeCapabilities;
  kind: FileScopeKind;
  uploadPurpose: FilePurpose;
  resolveUploadTargetContext(input: ResolveUploadTargetInput): Promise<FileUploadTargetContext>;
}

interface FileScopeDescriptorDefinition<Kind extends FileUploadTargetKind> {
  capabilities: FileScopeCapabilities;
  kind: Kind;
  uploadPurpose: FilePurpose;
  resolveUploadTargetContext(
    input: ResolveUploadTargetInput<FileUploadTargetForKind<Kind>>,
  ): Promise<FileUploadTargetContext>;
}

function defineFileScopeDescriptor<Kind extends FileUploadTargetKind>(
  descriptor: FileScopeDescriptorDefinition<Kind>,
): FileScopeDescriptor {
  return {
    capabilities: descriptor.capabilities,
    kind: descriptor.kind,
    uploadPurpose: descriptor.uploadPurpose,
    async resolveUploadTargetContext(input) {
      if (input.target.kind !== descriptor.kind) {
        throw createFileInvalidRequestError(
          `File target ${input.target.kind} cannot be resolved by ${descriptor.kind}.`,
        );
      }

      return descriptor.resolveUploadTargetContext({
        ...input,
        target: input.target as FileUploadTargetForKind<Kind>,
      });
    },
  };
}

const accountDescriptor = defineFileScopeDescriptor({
  capabilities: {
    moveRename: {
      enabled: false,
    },
    pathLocks: false,
    versioning: false,
  },
  kind: "account",
  uploadPurpose: "account_avatar",
  async resolveUploadTargetContext({ fileId, target, viewer }) {
    const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
    const targetId: AccountId = parsePlatformId(target.id, "upload account ID");

    if (targetId !== viewerId) {
      throw createFileInvalidRequestError("Avatars can only be uploaded for the current account.");
    }

    const name = normalizeFileName(target.name);
    const logicalPath = createAccountAvatarPath(fileId, name);

    return {
      logicalPath,
      name,
      ownerId: viewerId,
      ownerKind: "account",
      parentPath: getParentPath(logicalPath),
      scopeId: viewerId,
      scopeKind: "account",
      sessionKind: null,
    };
  },
});

const libraryDescriptor = defineFileScopeDescriptor({
  capabilities: {
    moveRename: {
      enabled: true,
      eventName: "file.library.updated",
      normalizePath: ensureLibraryFilePathHasExtension,
    },
    pathLocks: true,
    versioning: true,
  },
  kind: "library",
  uploadPurpose: "library_file",
  async resolveUploadTargetContext({ bindings, target, viewer }) {
    const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
    const scopeId: AppId = parsePlatformId(target.id, "upload library app ID");
    await ensureAppOwnership(bindings.DB, viewerId, scopeId);

    const logicalPath = normalizeLibraryFilePath(target.path);
    const fileName = logicalPath.split("/").pop() ?? logicalPath;

    return {
      logicalPath,
      name: fileName,
      ownerId: scopeId,
      ownerKind: "app",
      parentPath: getParentPath(logicalPath),
      scopeId,
      scopeKind: "library",
      sessionKind: null,
    };
  },
});

const sessionDescriptor = defineFileScopeDescriptor({
  capabilities: {
    moveRename: {
      enabled: false,
    },
    pathLocks: false,
    versioning: false,
  },
  kind: "session",
  uploadPurpose: "session_attachment",
  async resolveUploadTargetContext({ bindings, fileId, target, viewer }) {
    const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
    const appId: AppId = parsePlatformId(target.appId, "upload session app ID");
    await ensureAppSessionFileAccess(bindings.DB, viewerId, {
      appId,
      sessionId: target.id,
    });

    const name = normalizeFileName(target.name);
    const logicalPath = createAttachmentPath(fileId, name);

    return {
      logicalPath,
      name,
      ownerId: target.id,
      ownerKind: "session",
      parentPath: getParentPath(logicalPath),
      scopeId: target.id,
      scopeKind: "session",
      sessionKind: "attachment",
    };
  },
});

const agentPackageDescriptor = defineFileScopeDescriptor({
  capabilities: {
    moveRename: {
      enabled: false,
    },
    pathLocks: false,
    versioning: false,
  },
  kind: "agent_package",
  uploadPurpose: "agent_package",
  async resolveUploadTargetContext({ bindings, fileId, target, viewer }) {
    const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
    const scopeId: AppId = parsePlatformId(target.id, "upload agent package app ID");
    await ensureAppOwnership(bindings.DB, viewerId, scopeId);

    const name = normalizeFileName(target.name);
    const logicalPath = createAttachmentPath(fileId, name);

    return {
      logicalPath,
      name,
      ownerId: scopeId,
      ownerKind: "app",
      parentPath: getParentPath(logicalPath),
      scopeId,
      scopeKind: "agent_package",
      sessionKind: null,
    };
  },
});

const appDraftDescriptor = defineFileScopeDescriptor({
  capabilities: {
    moveRename: {
      enabled: false,
    },
    pathLocks: false,
    versioning: false,
  },
  kind: "app_draft",
  uploadPurpose: "app_draft",
  async resolveUploadTargetContext({ bindings, fileId, target, viewer }) {
    const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
    const scopeId: AppId = parsePlatformId(target.id, "upload app draft app ID");
    await ensureAppOwnership(bindings.DB, viewerId, scopeId);

    const name = normalizeFileName(target.name);
    const logicalPath = createAttachmentPath(fileId, name);

    return {
      logicalPath,
      name,
      ownerId: scopeId,
      ownerKind: "app",
      parentPath: getParentPath(logicalPath),
      scopeId,
      scopeKind: "app_draft",
      sessionKind: "attachment",
    };
  },
});

const fileScopeDescriptors = {
  account: accountDescriptor,
  agent_package: agentPackageDescriptor,
  app_draft: appDraftDescriptor,
  library: libraryDescriptor,
  session: sessionDescriptor,
} satisfies Record<FileScopeKind, FileScopeDescriptor>;

const fileScopeDescriptorsByKind: Record<string, FileScopeDescriptor | undefined> =
  fileScopeDescriptors;

export function getFileScopeDescriptor(scopeKind: FileScopeKind | string): FileScopeDescriptor {
  const descriptor = fileScopeDescriptorsByKind[scopeKind];

  if (descriptor === undefined) {
    throw createFileInvalidRequestError(`Unsupported file scope kind: ${scopeKind}.`);
  }

  return descriptor;
}

export async function resolveFileUploadTargetContext(
  input: ResolveUploadTargetInput,
): Promise<FileUploadTargetContext> {
  const descriptor = getFileScopeDescriptor(input.target.kind);
  return descriptor.resolveUploadTargetContext(input);
}
