import { parsePlatformId } from "@mosoo/id";
import type { AccountId, DriverInstanceId, SessionId } from "@mosoo/id";
import { readRuntimeEventFileChanges } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { createErrorLogContext, logWarn } from "../../../../platform/cloudflare/logger";
import { withDisposedRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import {
  createRuntimeOutputContentSha256,
  createRuntimeOutputParentPath,
  fileStore,
} from "../../../files/application/file-store";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { getRuntimeConversationSession } from "../runtime-subject-lifecycle/runtime-subject-store";
import { readSandboxFileBytes } from "../sandbox-file-bytes";
import type { ExecutionSessionHandle } from "../sandbox-handles";
import type { RuntimeSessionLink } from "./event-types";
import {
  RUNTIME_SESSION_OUTPUT_DIR_NAME,
  RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES,
  getRuntimeSessionOutputDirectory,
  guessRuntimeSessionOutputContentType,
  readRuntimeSessionOutputListing,
  toRuntimeSessionOutputArtifactPath,
  toRuntimeSessionOutputFile,
} from "./runtime-session-outputs";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function resolveRuntimeOutputCreator(link: RuntimeSessionLink): AccountId | null {
  const actorId = link.executionOwnerId ?? link.callerId ?? link.creatorId;

  if (!isTruthy(actorId)) {
    return null;
  }

  return parsePlatformId<AccountId>(actorId, "runtime output creator account ID");
}

function readRuntimeFileChangeContentType(
  metadata: Record<string, unknown> | undefined,
): string | null {
  const contentType = metadata?.["contentType"] ?? metadata?.["mimeType"];
  return typeof contentType === "string" && contentType.trim().length > 0 ? contentType : null;
}

function createRuntimeSessionOutputListCommand(outputDir: string): string {
  const quotedOutputDir = quoteShellArg(outputDir);
  const command = [
    `if [ ! -d ${quotedOutputDir} ]; then exit 0; fi`,
    `cd ${quotedOutputDir}`,
    `find . -type f -print | sed 's#^\\./##' | sort | head -n ${RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES}`,
  ].join(" && ");

  return `sh -lc ${quoteShellArg(command)}`;
}

async function listRuntimeSessionOutputFiles(
  handle: ExecutionSessionHandle,
  outputDir: string,
): Promise<string[]> {
  const result = await handle.exec(createRuntimeSessionOutputListCommand(outputDir));

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Failed to list runtime session outputs in ${outputDir}.`,
    );
  }

  return readRuntimeSessionOutputListing(result.stdout);
}

async function recordRuntimeSessionOutputFile(input: {
  bindings: ApiBindings;
  body: Uint8Array;
  contentType: string | null;
  createdBy: AccountId;
  existingArtifacts: Set<string>;
  path: string;
  recordedArtifacts: Set<string>;
  sessionId: SessionId;
}): Promise<void> {
  const contentSha256 = await createRuntimeOutputContentSha256(input.body);
  const artifactKey = createRuntimeOutputParentPath(input.path, contentSha256);

  if (input.recordedArtifacts.has(artifactKey) || input.existingArtifacts.has(artifactKey)) {
    return;
  }

  await fileStore.recordRuntimeOutput({
    bindings: input.bindings,
    body: input.body,
    contentSha256,
    contentType: input.contentType,
    createdBy: input.createdBy,
    path: input.path,
    sessionId: input.sessionId,
  });
  input.recordedArtifacts.add(artifactKey);
  input.existingArtifacts.add(artifactKey);
}

export async function recordRuntimeFileChanges(input: {
  bindings: ApiBindings;
  event: RuntimeEventEnvelope;
  link: RuntimeSessionLink;
}): Promise<void> {
  const sessionId = input.link.sessionId;
  const sandboxId = input.link.sandboxId;
  const createdBy = resolveRuntimeOutputCreator(input.link);
  const changes = readRuntimeEventFileChanges(input.event).filter(
    (change) => change.change === "upsert",
  );

  if (changes.length === 0) {
    return;
  }

  if (sessionId === null || sandboxId === null || createdBy === null) {
    logWarn("runtime.file_artifact.record_skipped", {
      driverInstanceId: input.event.driverInstanceId ?? null,
      hasCreatedBy: createdBy !== null,
      sandboxId,
      sessionId,
    });
    return;
  }

  const conversation = await getRuntimeConversationSession(input.bindings.DB, sessionId);

  if (conversation === null) {
    logWarn("runtime.file_artifact.record_skipped.missing_session", {
      sandboxId,
      sessionId,
    });
    return;
  }

  const outputChanges = changes.flatMap((change) => {
    const outputFile = toRuntimeSessionOutputFile({
      contentType: readRuntimeFileChangeContentType(change.metadata),
      cwd: conversation.cwd,
      path: change.path,
    });

    return outputFile === null ? [] : [outputFile];
  });

  if (outputChanges.length === 0) {
    return;
  }

  const parsedSessionId = parsePlatformId<SessionId>(sessionId, "runtime output session ID");
  const existingArtifacts = new Set(
    await fileStore.listReadySessionArtifactKeys(input.bindings.DB, parsedSessionId),
  );
  const recordedArtifacts = new Set<string>();

  await withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(input.bindings, sandboxId),
    async (sandbox) => {
      const sandboxSession = await sandbox.getSession(conversation.sandboxSessionId);

      for (const outputFile of outputChanges) {
        try {
          await recordRuntimeSessionOutputFile({
            bindings: input.bindings,
            body: await readSandboxFileBytes(sandboxSession, outputFile.readPath),
            contentType: outputFile.contentType,
            createdBy,
            existingArtifacts,
            path: outputFile.artifactPath,
            recordedArtifacts,
            sessionId: parsedSessionId,
          });
        } catch (error) {
          logWarn("runtime.file_artifact.record_failed", {
            ...createErrorLogContext(error),
            path: outputFile.artifactPath,
            sandboxId,
            sessionId,
          });
        }
      }
    },
  );
}

export async function recordRuntimeSessionOutputDirectory(input: {
  bindings: ApiBindings;
  driverInstanceId: DriverInstanceId | null;
  link: RuntimeSessionLink;
}): Promise<void> {
  const sessionId = input.link.sessionId;
  const sandboxId = input.link.sandboxId;
  const createdBy = resolveRuntimeOutputCreator(input.link);

  if (sessionId === null || sandboxId === null || createdBy === null) {
    return;
  }

  const parsedSessionId = parsePlatformId<SessionId>(sessionId, "runtime output session ID");
  let conversation;

  try {
    conversation = await getRuntimeConversationSession(input.bindings.DB, parsedSessionId);
  } catch (error) {
    logWarn("runtime.file_artifact.output_scan_session_lookup_failed", {
      ...createErrorLogContext(error),
      driverInstanceId: input.driverInstanceId,
      sandboxId,
      sessionId,
    });
    return;
  }

  if (conversation === null) {
    return;
  }

  try {
    await withDisposedRpcResource(
      await getRuntimeSubjectKeepAliveHandle(input.bindings, sandboxId),
      async (sandbox) => {
        const sandboxSession = await sandbox.getSession(conversation.sandboxSessionId);
        const outputDir = getRuntimeSessionOutputDirectory(conversation.cwd);
        const outputPaths = await listRuntimeSessionOutputFiles(sandboxSession, outputDir);

        if (outputPaths.length === 0) {
          return;
        }

        const existingArtifacts = new Set(
          await fileStore.listReadySessionArtifactKeys(input.bindings.DB, parsedSessionId),
        );
        const recordedArtifacts = new Set<string>();

        for (const outputPath of outputPaths) {
          const artifactPath = toRuntimeSessionOutputArtifactPath(outputPath);

          try {
            await recordRuntimeSessionOutputFile({
              bindings: input.bindings,
              body: await readSandboxFileBytes(sandboxSession, `${outputDir}/${outputPath}`),
              contentType: guessRuntimeSessionOutputContentType(outputPath),
              createdBy,
              existingArtifacts,
              path: artifactPath,
              recordedArtifacts,
              sessionId: parsedSessionId,
            });
          } catch (error) {
            logWarn("runtime.file_artifact.output_record_failed", {
              ...createErrorLogContext(error),
              path: artifactPath,
              sandboxId,
              sessionId,
            });
          }
        }
      },
    );
  } catch (error) {
    logWarn("runtime.file_artifact.output_scan_failed", {
      ...createErrorLogContext(error),
      driverInstanceId: input.driverInstanceId,
      outputDir: `${RUNTIME_SESSION_OUTPUT_DIR_NAME}/`,
      sandboxId,
      sessionId,
    });
  }
}
