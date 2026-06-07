import {
  SANDBOX_SESSION_ROOT,
  SANDBOX_SESSION_STATE_DIR,
  SANDBOX_WORKSPACE_ROOT,
} from "agent-driver/paths";

import { withDisposedRpcResource } from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { notFoundError, validationError } from "../../../platform/errors";
import {
  createRuntimeSubjectLifecycleService,
  getRuntimeSubjectKeepAliveHandle,
  prepareRuntimeSubjectFilesystem,
} from "../infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import type { ExecutionSessionHandle } from "../infrastructure/sandbox-handles";
import {
  LISTING_TOTAL_MARKER,
  MAX_DIRECTORY_ENTRIES,
  classifyAgentFilePreview,
  inferMimeType,
  parseAgentFileListingOutput,
} from "./agent-file-browser-listing";
import type {
  AgentFileEntryKind,
  AgentFilePreview,
  AgentFileSandboxStatus,
  ListingParseResult,
} from "./agent-file-browser-model";
import type { AgentFileBrowserTarget } from "./agent-file-browser-target.service";

export interface AgentFileMetadata {
  kind: Exclude<AgentFileEntryKind, "directory" | "space_mount">;
  mimeType: string;
  name: string;
  path: string;
  preview: AgentFilePreview;
  sizeBytes: number;
}

function buildListDirectoryCommand(path: string): string {
  const quotedPath = quoteShellArg(path);

  return [
    `dir=${quotedPath}`,
    `if [ ! -d "$dir" ]; then exit 66; fi`,
    "total=0",
    "shown=0",
    `for entry in "$dir"/.[!.]* "$dir"/..?* "$dir"/*; do`,
    `  [ -e "$entry" ] || [ -L "$entry" ] || continue`,
    `  name="\${entry##*/}"`,
    `  [ "$name" = "cache" ] && [ "$dir" = "${SANDBOX_WORKSPACE_ROOT}" ] && continue`,
    `  if [ "$name" = "space" ]; then`,
    `    session_tail="\${dir#${SANDBOX_SESSION_ROOT}/}"`,
    `    [ "$session_tail" != "$dir" ] && [ "$session_tail" = "\${session_tail%%/*}" ] && continue`,
    `  fi`,
    `  if [ "$name" = "${SANDBOX_SESSION_STATE_DIR}" ]; then`,
    `    session_tail="\${dir#${SANDBOX_SESSION_ROOT}/}"`,
    `    [ "$session_tail" != "$dir" ] && [ "$session_tail" = "\${session_tail%%/*}" ] && continue`,
    `  fi`,
    `  total=$((total + 1))`,
    `  if [ "$shown" -lt ${MAX_DIRECTORY_ENTRIES} ]; then`,
    `    if [ -L "$entry" ]; then kind=symlink; elif [ -d "$entry" ]; then kind=directory; else kind=file; fi`,
    `    if [ -f "$entry" ] && [ ! -L "$entry" ]; then size=$(wc -c < "$entry" 2>/dev/null | tr -d '[:space:]'); else size=0; fi`,
    `    encoded=$(printf '%s' "$name" | base64 | tr -d '\\n')`,
    `    printf '%s\\t%s\\t%s\\n' "$kind" "\${size:-0}" "$encoded"`,
    `    shown=$((shown + 1))`,
    "  fi",
    "done",
    `printf '${LISTING_TOTAL_MARKER}\\t%s\\t\\n' "$total"`,
  ].join("\n");
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildFileMetadataCommand(path: string): string {
  const quotedPath = quoteShellArg(path);

  return [
    `target=${quotedPath}`,
    `if [ ! -e "$target" ] && [ ! -L "$target" ]; then exit 66; fi`,
    `if [ -L "$target" ]; then exit 67; fi`,
    `if [ -d "$target" ]; then exit 65; fi`,
    `kind=file`,
    `size=$(wc -c < "$target" 2>/dev/null | tr -d '[:space:]')`,
    `name="\${target##*/}"`,
    `encoded=$(printf '%s' "$name" | base64 | tr -d '\\n')`,
    `mime=$(file -b --mime-type "$target" 2>/dev/null || true)`,
    `printf '%s\\t%s\\t%s\\t%s\\n' "$kind" "\${size:-0}" "$encoded" "$mime"`,
  ].join("\n");
}

async function runShell(handle: ExecutionSessionHandle, command: string): Promise<string> {
  const result = await handle.exec(`sh -lc ${quoteShellArg(command)}`);

  if (!result.success || result.exitCode !== 0) {
    if (result.exitCode === 66) {
      throw notFoundError("Agent file path was not found.");
    }

    if (result.exitCode === 65) {
      throw validationError("Agent file path is not a readable file.");
    }

    if (result.exitCode === 67) {
      throw validationError("Symlinks cannot be opened in Agent File Browser.");
    }

    const message = result.stderr.trim() || result.stdout.trim() || "Sandbox file command failed.";
    throw new Error(message);
  }

  return result.stdout;
}

export async function listSandboxDirectory(
  handle: ExecutionSessionHandle,
  path: string,
): Promise<ListingParseResult> {
  return parseAgentFileListingOutput(path, await runShell(handle, buildListDirectoryCommand(path)));
}

function parseFileMetadata(path: string, output: string): AgentFileMetadata {
  const line = output.split("\n").find((entry) => entry.trim().length > 0);

  if (line === undefined) {
    throw new Error("Sandbox file metadata command returned no data.");
  }

  const rawMimeType = line.split("\t")[3];
  const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
  const parsed = parseAgentFileListingOutput(parentPath, line);
  const [entry] = parsed.entries;

  if (entry === undefined || entry.kind === "directory" || entry.kind === "space_mount") {
    throw new Error("Sandbox file metadata did not describe a readable file.");
  }

  const mimeType =
    rawMimeType && rawMimeType.length > 0
      ? rawMimeType
      : (entry.mimeType ?? inferMimeType(path, entry.kind) ?? "application/octet-stream");
  const preview = classifyAgentFilePreview({
    mimeType,
    path,
    sizeBytes: entry.sizeBytes,
  });

  return {
    kind: entry.kind,
    mimeType,
    name: entry.name,
    path,
    preview,
    sizeBytes: entry.sizeBytes,
  };
}

export async function getSandboxFileMetadata(
  handle: ExecutionSessionHandle,
  path: string,
): Promise<AgentFileMetadata> {
  return parseFileMetadata(path, await runShell(handle, buildFileMetadataCommand(path)));
}

export function isSandboxReadable(status: AgentFileSandboxStatus): boolean {
  return status === "active" || status === "backing_up" || status === "cold";
}

export async function withReadableSandbox<T>(
  bindings: ApiBindings,
  target: AgentFileBrowserTarget,
  read: (handle: ExecutionSessionHandle) => Promise<T>,
): Promise<T> {
  if (target.sandbox === null || !isSandboxReadable(target.sandbox.status)) {
    throw notFoundError("Agent sandbox is not available.");
  }

  const sandbox =
    target.sandbox.status === "cold"
      ? (
          await createRuntimeSubjectLifecycleService(bindings).activate({
            executionOwnerUserId: target.agent.ownerId,
            kind: target.subject.kind,
            runtimeSubjectId: target.sandbox.id,
            spaceAliases: [],
            subjectId: target.subject.subjectId,
            subjectKind: target.subject.subjectKind,
          })
        ).subject
      : await getRuntimeSubjectKeepAliveHandle(bindings, target.sandbox.id);

  // Local dev can keep D1 lifecycle state after the backing container is gone.
  // Re-assert the platform roots before exposing a filesystem snapshot.
  await prepareRuntimeSubjectFilesystem(sandbox);

  return withDisposedRpcResource(sandbox, read);
}

export function decodeSandboxBase64(content: string): Uint8Array {
  return Uint8Array.from(atob(content), (char) => char.codePointAt(0) ?? 0);
}
