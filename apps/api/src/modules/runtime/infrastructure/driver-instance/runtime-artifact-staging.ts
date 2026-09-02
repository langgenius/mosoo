import { createSessionArtifactPath, normalizeContentType } from "@mosoo/contracts/file";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, FileId, SessionId, SessionRunId } from "@mosoo/id";
import { readRuntimeEventFileChanges } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { withDisposedRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { quoteShellArg } from "../../../../shared/shell";
import {
  createRuntimeOutputContentSha256,
  createRuntimeOutputParentPath,
  getRuntimeOutputName,
  putRuntimeArtifactObject,
} from "../../../files/application/file-store";
import type { DriverRuntimeEventFence } from "../../../sessions/infrastructure/session-runtime-event-store.types";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { getRuntimeConversationSession } from "../runtime-subject-lifecycle/runtime-subject-store";
import { readSandboxFileBytes } from "../sandbox-file-bytes";
import type { ExecutionSessionHandle } from "../sandbox-handles";
import type { RuntimeSessionLink } from "./event-types";
import {
  claimRuntimeArtifactObjectKey,
  createRuntimeArtifactAttempt,
  createRuntimeArtifactManifest,
  getReadyRuntimeArtifact,
  sealRuntimeArtifactAttempt,
} from "./runtime-artifact-attempt.repository";
import type {
  RuntimeArtifactCapturePlan,
  RuntimeArtifactCapturePlanFile,
  RuntimeArtifactManifestFile,
  StagedRuntimeArtifactProjection,
} from "./runtime-artifact-attempt.repository";
import {
  RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES,
  RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES,
  RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES,
  getRuntimeSessionOutputDirectory,
  guessRuntimeSessionOutputContentType,
  readRuntimeSessionOutputInventory,
  toRuntimeSessionOutputArtifactPath,
  toRuntimeSessionOutputFile,
} from "./runtime-session-outputs";

export interface DurableRuntimeArtifactEvent {
  readonly event: RuntimeEventEnvelope;
  readonly semanticHash: string;
  readonly sourceEventId: string;
}

interface RuntimeArtifactCaptureUpsert {
  readonly contentType: string | null;
  readonly expectedSize: number | null;
  readonly operation: "upsert";
  readonly readPath: string;
  readonly sourcePath: string;
}

type RuntimeArtifactCaptureFile =
  | RuntimeArtifactCaptureUpsert
  | { readonly operation: "delete"; readonly sourcePath: string };

interface RuntimeArtifactCaptureSources {
  readonly captureStatus: RuntimeArtifactCapturePlan["captureStatus"];
  readonly files: readonly RuntimeArtifactCaptureFile[];
  readonly mode: "delta" | "snapshot";
  readonly sandboxSessionId: string | null;
  readonly sourcePaths: readonly string[];
}

class RuntimeArtifactCaptureUnavailable extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RuntimeArtifactCaptureUnavailable";
  }
}

function omittedRuntimeArtifactSources(mode: "delta" | "snapshot"): RuntimeArtifactCaptureSources {
  return {
    captureStatus: "omitted_runtime_unavailable",
    files: [],
    mode,
    sandboxSessionId: null,
    sourcePaths: [],
  };
}

async function captureRuntimeArtifactSourcesOrOmit(
  mode: "delta" | "snapshot",
  capture: () => Promise<RuntimeArtifactCaptureSources>,
): Promise<RuntimeArtifactCaptureSources> {
  try {
    return await capture();
  } catch (error) {
    if (error instanceof RuntimeArtifactCaptureUnavailable) {
      return omittedRuntimeArtifactSources(mode);
    }
    throw error;
  }
}

function readRuntimeFileChangeContentType(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const contentType = metadata?.["contentType"] ?? metadata?.["mimeType"];
  return typeof contentType === "string" && contentType.trim().length > 0 ? contentType : null;
}

function resolveRuntimeOutputCreator(link: RuntimeSessionLink): AccountId | null {
  const actorId = link.executionOwnerId ?? link.callerId ?? link.creatorId;
  return actorId === null ? null : parsePlatformId<AccountId>(actorId, "runtime output creator");
}

function createRuntimeSessionOutputListCommand(outputDir: string): string {
  const quotedOutputDir = quoteShellArg(outputDir);
  const command = [
    `if [ ! -d ${quotedOutputDir} ]; then exit 0; fi`,
    `cd ${quotedOutputDir}`,
    "runtime_output_scan_file=$(mktemp)",
    "trap 'rm -f \"$runtime_output_scan_file\"' EXIT",
    `find . -type f -print0 | head -z -n ${RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES + 1} > "$runtime_output_scan_file"; runtime_output_pipe_status=("\${PIPESTATUS[@]}"); runtime_output_find_status="\${runtime_output_pipe_status[0]}"; runtime_output_head_status="\${runtime_output_pipe_status[1]}"; if { [ "$runtime_output_find_status" -ne 0 ] && [ "$runtime_output_find_status" -ne 141 ]; } || [ "$runtime_output_head_status" -ne 0 ]; then exit 1; fi`,
    'LC_ALL=C sort -z -o "$runtime_output_scan_file" "$runtime_output_scan_file"',
    "xargs -0 -r stat --printf='%n\\0%s\\0' -- < \"$runtime_output_scan_file\"",
  ].join(" && ");
  return `bash -lc ${quoteShellArg(command)}`;
}

async function listRuntimeSessionOutputFiles(
  handle: ExecutionSessionHandle,
  outputDir: string,
): Promise<Pick<RuntimeArtifactCaptureSources, "captureStatus" | "files">> {
  const result = await handle.exec(createRuntimeSessionOutputListCommand(outputDir));
  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Failed to list runtime session outputs in ${outputDir}.`,
    );
  }
  const inventory = readRuntimeSessionOutputInventory(result.stdout);
  if (inventory.length > RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES) {
    return { captureStatus: "omitted_file_limit", files: [] };
  }
  let totalBytes = 0;
  for (const file of inventory) {
    if (
      file.size > RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES ||
      totalBytes > RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES - file.size
    ) {
      return { captureStatus: "omitted_size_limit", files: [] };
    }
    totalBytes += file.size;
  }
  return {
    captureStatus: "complete",
    files: inventory.map((file) => ({
      contentType: guessRuntimeSessionOutputContentType(file.relativePath),
      expectedSize: file.size,
      operation: "upsert",
      readPath: `${outputDir}/${file.relativePath}`,
      sourcePath: toRuntimeSessionOutputArtifactPath(file.relativePath),
    })),
  };
}

async function readRuntimeArtifactFileSize(
  handle: ExecutionSessionHandle,
  path: string,
): Promise<number | null> {
  const quotedPath = quoteShellArg(path);
  const result = await handle.exec(
    `sh -lc ${quoteShellArg(
      `if runtime_output_size=$(stat --printf='%s' -- ${quotedPath}); then printf '%s' "$runtime_output_size"; elif [ ! -e ${quotedPath} ]; then exit 44; else exit 1; fi`,
    )}`,
  );
  if (result.exitCode === 44) {
    return null;
  }
  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || `Failed to stat runtime output ${path}.`,
    );
  }
  const output = result.stdout.trim();
  const size = Number(output);
  if (!/^\d+$/.test(output) || !Number.isSafeInteger(size)) {
    throw new Error(`Runtime output size is invalid for ${path}.`);
  }
  return size;
}

function getRuntimeArtifactCaptureStatus(
  files: readonly RuntimeArtifactCaptureFile[],
): RuntimeArtifactCaptureSources["captureStatus"] {
  if (files.length > RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES) {
    return "omitted_file_limit";
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.operation === "delete") {
      continue;
    }
    if (file.expectedSize === null) {
      throw new Error(`Runtime output size is missing for ${file.sourcePath}.`);
    }
    if (
      file.expectedSize > RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES ||
      totalBytes > RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES - file.expectedSize
    ) {
      return "omitted_size_limit";
    }
    totalBytes += file.expectedSize;
  }
  return "complete";
}

function isRuntimeArtifactEvent(event: RuntimeEventEnvelope): boolean {
  return (
    event.kind === "file.change.updated" ||
    event.kind === "file.changed" ||
    event.kind === "run.completed"
  );
}

async function captureRuntimeFileChangeSources(input: {
  bindings: ApiBindings;
  event: RuntimeEventEnvelope;
  excludedSourcePaths: ReadonlySet<string>;
  link: RuntimeSessionLink;
}): Promise<RuntimeArtifactCaptureSources> {
  if (input.link.sessionId === null || input.link.sandboxId === null) {
    throw new RuntimeArtifactCaptureUnavailable(
      "Runtime file artifact event is missing its active sandbox identity.",
    );
  }
  const conversation = await getRuntimeConversationSession(input.bindings.DB, input.link.sessionId);
  if (conversation === null) {
    throw new RuntimeArtifactCaptureUnavailable(
      "Runtime file artifact event is missing its sandbox conversation.",
    );
  }
  const filesByPath = new Map<string, RuntimeArtifactCaptureFile>();
  for (const change of readRuntimeEventFileChanges(input.event)) {
    const outputFile = toRuntimeSessionOutputFile({
      contentType: readRuntimeFileChangeContentType(change.metadata),
      cwd: conversation.cwd,
      path: change.path,
    });
    if (outputFile === null) {
      continue;
    }
    filesByPath.set(
      outputFile.artifactPath,
      change.change === "delete"
        ? { operation: "delete", sourcePath: outputFile.artifactPath }
        : {
            contentType: outputFile.contentType,
            expectedSize: null,
            operation: "upsert",
            readPath: outputFile.readPath,
            sourcePath: outputFile.artifactPath,
          },
    );
  }
  const sourcePaths = [...filesByPath.keys()];
  const files = [...filesByPath.values()]
    .filter((file) => !input.excludedSourcePaths.has(file.sourcePath))
    .toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  if (files.length > RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES) {
    return {
      captureStatus: "omitted_file_limit",
      files: [],
      mode: "delta",
      sandboxSessionId: conversation.sandboxSessionId,
      sourcePaths,
    };
  }
  let sizedFiles = files;
  if (files.some((file) => file.operation === "upsert")) {
    try {
      sizedFiles = await withDisposedRpcResource(
        await getRuntimeSubjectKeepAliveHandle(
          input.bindings,
          input.link.sandboxId,
          conversation.sandboxIncarnation,
        ),
        async (sandbox) => {
          const sandboxSession = await sandbox.getSession(conversation.sandboxSessionId);
          return Promise.all(
            files.map(async (file) =>
              file.operation === "delete"
                ? file
                : {
                    contentType: file.contentType,
                    expectedSize: await readRuntimeArtifactFileSize(sandboxSession, file.readPath),
                    operation: file.operation,
                    readPath: file.readPath,
                    sourcePath: file.sourcePath,
                  },
            ),
          );
        },
      );
    } catch (error) {
      throw new RuntimeArtifactCaptureUnavailable(
        "Runtime file artifact sources are unavailable.",
        error,
      );
    }
  }
  const captureStatus = sizedFiles.some(
    (file) => file.operation === "upsert" && file.expectedSize === null,
  )
    ? "omitted_source_missing"
    : getRuntimeArtifactCaptureStatus(sizedFiles);
  return {
    captureStatus,
    files: captureStatus === "complete" ? sizedFiles : [],
    mode: "delta",
    sandboxSessionId: conversation.sandboxSessionId,
    sourcePaths,
  };
}

async function captureRuntimeOutputSnapshotSources(input: {
  bindings: ApiBindings;
  link: RuntimeSessionLink;
}): Promise<RuntimeArtifactCaptureSources> {
  if (input.link.sessionId === null || input.link.sandboxId === null) {
    throw new RuntimeArtifactCaptureUnavailable(
      "Runtime output snapshot is missing its active sandbox identity.",
    );
  }
  const conversation = await getRuntimeConversationSession(input.bindings.DB, input.link.sessionId);
  if (conversation === null) {
    throw new RuntimeArtifactCaptureUnavailable(
      "Runtime output snapshot is missing its sandbox conversation.",
    );
  }
  const outputDir = getRuntimeSessionOutputDirectory(conversation.cwd);
  let capture: Pick<RuntimeArtifactCaptureSources, "captureStatus" | "files">;
  try {
    capture = await withDisposedRpcResource(
      await getRuntimeSubjectKeepAliveHandle(
        input.bindings,
        input.link.sandboxId,
        conversation.sandboxIncarnation,
      ),
      async (sandbox) => {
        const sandboxSession = await sandbox.getSession(conversation.sandboxSessionId);
        return listRuntimeSessionOutputFiles(sandboxSession, outputDir);
      },
    );
  } catch (error) {
    throw new RuntimeArtifactCaptureUnavailable("Runtime output snapshot is unavailable.", error);
  }
  return {
    ...capture,
    mode: "snapshot",
    sandboxSessionId: conversation.sandboxSessionId,
    sourcePaths: capture.files.map((file) => file.sourcePath),
  };
}

async function stageRuntimeArtifactOmission(
  bindings: ApiBindings,
  input: {
    readonly createdByAccountId: AccountId;
    readonly driverFence: DriverRuntimeEventFence;
    readonly event: DurableRuntimeArtifactEvent;
    readonly mode: "delta" | "snapshot";
    readonly runId: SessionRunId;
    readonly sessionId: SessionId;
  },
): Promise<StagedRuntimeArtifactProjection> {
  const attemptId = crypto.randomUUID();
  await createRuntimeArtifactAttempt(bindings.DB, {
    attemptId,
    createdByAccountId: input.createdByAccountId,
    driverFence: input.driverFence,
    eventType: input.event.event.kind,
    runId: input.runId,
    semanticHash: input.event.semanticHash,
    sessionId: input.sessionId,
    sourceEventId: input.event.sourceEventId,
  });
  const manifest = await createRuntimeArtifactManifest({
    captureStatus: "omitted_runtime_unavailable",
    files: [],
    mode: input.mode,
    semanticHash: input.event.semanticHash,
    sourceEventId: input.event.sourceEventId,
  });
  const projection = { attemptId, ...manifest };
  await sealRuntimeArtifactAttempt(bindings.DB, projection);
  return projection;
}

export async function stageRuntimeArtifactEvents(
  bindings: ApiBindings,
  input: {
    readonly driverFence: DriverRuntimeEventFence;
    readonly events: readonly DurableRuntimeArtifactEvent[];
    readonly link: RuntimeSessionLink;
  },
): Promise<ReadonlyMap<string, StagedRuntimeArtifactProjection>> {
  const staged = new Map<string, StagedRuntimeArtifactProjection>();
  if (input.link.sessionId === null || input.link.sessionRunId === null) {
    if (input.events.some(({ event }) => isRuntimeArtifactEvent(event))) {
      throw new Error("Runtime artifact events require a Session Run identity.");
    }
    return staged;
  }
  const runId = input.link.sessionRunId;
  const createdBy = resolveRuntimeOutputCreator(input.link);
  if (createdBy === null) {
    throw new Error("Runtime artifact events require a creator identity.");
  }
  const sessionId = parsePlatformId<SessionId>(input.link.sessionId, "runtime output session ID");
  const artifactEvents = input.events.filter(({ event }) => isRuntimeArtifactEvent(event));
  const completedEvent = artifactEvents.find(({ event }) => event.kind === "run.completed");
  const stageUnavailableArtifacts = async (): Promise<
    ReadonlyMap<string, StagedRuntimeArtifactProjection>
  > => {
    const projections = new Map<string, StagedRuntimeArtifactProjection>();
    for (const event of completedEvent === undefined ? artifactEvents : [completedEvent]) {
      projections.set(
        event.sourceEventId,
        await stageRuntimeArtifactOmission(bindings, {
          createdByAccountId: createdBy,
          driverFence: input.driverFence,
          event,
          mode: event.event.kind === "run.completed" ? "snapshot" : "delta",
          runId,
          sessionId,
        }),
      );
    }
    return projections;
  };
  const captures: { event: DurableRuntimeArtifactEvent; sources: RuntimeArtifactCaptureSources }[] =
    [];
  if (completedEvent !== undefined) {
    captures.push({
      event: completedEvent,
      sources: await captureRuntimeArtifactSourcesOrOmit("snapshot", () =>
        captureRuntimeOutputSnapshotSources({ bindings, link: input.link }),
      ),
    });
  } else {
    const laterPaths = new Set<string>();
    for (let index = artifactEvents.length - 1; index >= 0; index -= 1) {
      const event = artifactEvents[index];
      if (event === undefined) {
        continue;
      }
      const sources = await captureRuntimeArtifactSourcesOrOmit("delta", () =>
        captureRuntimeFileChangeSources({
          bindings,
          event: event.event,
          excludedSourcePaths: laterPaths,
          link: input.link,
        }),
      );
      for (const sourcePath of sources.sourcePaths) {
        laterPaths.add(sourcePath);
      }
      captures.unshift({
        event,
        sources,
      });
    }
  }
  if (captures.some(({ sources }) => sources.captureStatus === "omitted_runtime_unavailable")) {
    return stageUnavailableArtifacts();
  }

  for (const { event: durableEvent, sources } of captures) {
    if (
      sources.mode === "delta" &&
      sources.captureStatus === "complete" &&
      sources.files.length === 0
    ) {
      continue;
    }
    const proposedAttemptId = crypto.randomUUID();
    const proposedCapturePlan: RuntimeArtifactCapturePlan = {
      captureStatus: sources.captureStatus,
      files: sources.files.map((file) => {
        if (file.operation === "delete") {
          return file;
        }
        if (file.expectedSize === null) {
          throw new Error(`Runtime output size is missing for ${file.sourcePath}.`);
        }
        const fileId = createPlatformId<FileId>();
        return {
          contentType: file.contentType,
          expectedSize: file.expectedSize,
          fileId,
          name: getRuntimeOutputName(file.sourcePath),
          objectKey: `runtime-artifact-attempts/v1/${proposedAttemptId}/files/${fileId}`,
          operation: file.operation,
          readPath: file.readPath,
          sourcePath: file.sourcePath,
        };
      }),
      mode: sources.mode,
      version: 1,
    };
    await createRuntimeArtifactAttempt(bindings.DB, {
      attemptId: proposedAttemptId,
      createdByAccountId: createdBy,
      driverFence: input.driverFence,
      eventType: durableEvent.event.kind,
      runId,
      semanticHash: durableEvent.semanticHash,
      sessionId,
      sourceEventId: durableEvent.sourceEventId,
    });
    const attemptId = proposedAttemptId;
    const capturePlan = proposedCapturePlan;

    let captureStatus: RuntimeArtifactCapturePlan["captureStatus"] = capturePlan.captureStatus;
    const manifestFiles: RuntimeArtifactManifestFile[] = capturePlan.files.flatMap((file) =>
      file.operation === "delete" ? [file] : [],
    );
    const upserts = capturePlan.files.filter(
      (file): file is RuntimeArtifactCapturePlanFile => file.operation === "upsert",
    );
    const capturedBodies = new Map<string, Uint8Array>();
    if (captureStatus === "complete" && upserts.length > 0) {
      const sandboxSessionId = sources.sandboxSessionId;
      if (input.link.sandboxId === null || sandboxSessionId === null) {
        return stageUnavailableArtifacts();
      }
      const conversation = await getRuntimeConversationSession(bindings.DB, sessionId);
      if (
        conversation === null ||
        conversation.sandboxSessionId !== sandboxSessionId ||
        conversation.sandboxId !== input.link.sandboxId
      ) {
        return stageUnavailableArtifacts();
      }
      try {
        await withDisposedRpcResource(
          await getRuntimeSubjectKeepAliveHandle(
            bindings,
            input.link.sandboxId,
            conversation.sandboxIncarnation,
          ),
          async (sandbox) => {
            const sandboxSession = await sandbox.getSession(sandboxSessionId);
            let totalBytes = 0;
            for (const file of upserts) {
              const body = await readSandboxFileBytes(
                sandboxSession,
                file.readPath,
                RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES,
              );
              if (
                body.byteLength > RUNTIME_SESSION_OUTPUT_MAX_FILE_BYTES ||
                totalBytes > RUNTIME_SESSION_OUTPUT_MAX_TOTAL_BYTES - body.byteLength
              ) {
                captureStatus = "omitted_size_limit";
                capturedBodies.clear();
                return;
              }
              if (body.byteLength !== file.expectedSize) {
                captureStatus = "omitted_source_changed";
                capturedBodies.clear();
                return;
              }
              totalBytes += body.byteLength;
              capturedBodies.set(file.objectKey, body);
            }
          },
        );
      } catch {
        return stageUnavailableArtifacts();
      }
    }
    if (captureStatus !== "complete") {
      manifestFiles.length = 0;
    } else {
      let storageUnavailable = false;
      for (const file of upserts) {
        const body = capturedBodies.get(file.objectKey);
        if (body === undefined) {
          throw new Error(`Runtime output content is missing for ${file.sourcePath}.`);
        }
        const contentSha256 = await createRuntimeOutputContentSha256(body);
        const parentPath = createRuntimeOutputParentPath(file.sourcePath, contentSha256);
        const existing = await getReadyRuntimeArtifact(bindings.DB, {
          parentPath,
          sessionId,
        });
        if (existing !== null) {
          manifestFiles.push({
            contentSha256,
            contentType: existing.contentType,
            disposition: "reuse",
            etag: existing.etag,
            fileId: existing.fileId,
            name: existing.name,
            objectKey: existing.objectKey,
            operation: "upsert",
            parentPath,
            path: existing.path,
            size: existing.size,
            sourcePath: file.sourcePath,
          });
          continue;
        }
        await claimRuntimeArtifactObjectKey(bindings.DB, {
          attemptId,
          objectKey: file.objectKey,
        });
        const contentType = normalizeContentType(file.contentType ?? "application/octet-stream");
        const stored = await putRuntimeArtifactObject({
          attemptId,
          bindings,
          body,
          contentSha256,
          contentType,
          objectKey: file.objectKey,
          sourcePath: file.sourcePath,
        });
        if (stored === null) {
          storageUnavailable = true;
          break;
        }
        manifestFiles.push({
          contentSha256,
          contentType: stored.contentType ?? contentType,
          disposition: "create",
          etag: stored.etag,
          fileId: file.fileId,
          name: file.name,
          objectKey: file.objectKey,
          operation: "upsert",
          parentPath,
          path: createSessionArtifactPath(file.fileId, file.name),
          size: stored.contentLength,
          sourcePath: file.sourcePath,
        });
      }
      if (storageUnavailable) {
        return stageUnavailableArtifacts();
      }
    }
    const manifest = await createRuntimeArtifactManifest({
      captureStatus,
      files: manifestFiles,
      mode: sources.mode,
      semanticHash: durableEvent.semanticHash,
      sourceEventId: durableEvent.sourceEventId,
    });
    const projection = { attemptId, ...manifest };
    await sealRuntimeArtifactAttempt(bindings.DB, projection);
    staged.set(durableEvent.sourceEventId, projection);
  }
  return staged;
}
