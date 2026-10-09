import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { fileStore } from "../../../files/application/file-store";
import { RUNTIME_SESSION_OUTPUT_DIR_NAME } from "../driver-instance/runtime-session-outputs";
import { writeSandboxFileBytes } from "../sandbox-file-bytes";
import type { SandboxHandle } from "../sandbox-handles";

// Rehydrates a fresh session workspace from the session's recorded artifacts:
// for every recorded source path the newest ready artifact is written back to
// its original cwd-relative location. Only committed session artifacts are
// materialized — never other sessions' files, prior temporary files, caches,
// or native runtime state — so a recycled Cattle sandbox continues the same
// product Session without re-uploads while keeping Session-level isolation.
export async function restoreSessionArtifactsToWorkspace(
  bindings: ApiBindings,
  input: {
    cwd: string;
    sandbox: SandboxHandle;
    sessionId: SessionId;
  },
): Promise<void> {
  const outputsPrefix = `${RUNTIME_SESSION_OUTPUT_DIR_NAME}/`;
  // Recording only admits paths under outputs/; anything else in the record
  // set is malformed data and is skipped rather than written into the cwd.
  const sources = (
    await fileStore.listLatestReadySessionArtifactSources(bindings.DB, input.sessionId)
  ).filter((source) => source.sourcePath.startsWith(outputsPrefix));

  const preparedDirectories = new Set<string>();

  for (const source of sources) {
    const bytes = await fileStore.readSessionArtifactBytes(bindings, source.objectKey);

    if (bytes === null) {
      throw new Error(
        `Session artifact restore failed: object for ${source.sourcePath} is missing from storage.`,
      );
    }

    const targetPath = `${input.cwd}/${source.sourcePath}`;
    const parentDirectory = targetPath.slice(0, targetPath.lastIndexOf("/"));

    if (!preparedDirectories.has(parentDirectory)) {
      await input.sandbox.mkdir(parentDirectory, { recursive: true });
      preparedDirectories.add(parentDirectory);
    }

    await writeSandboxFileBytes(input.sandbox, targetPath, bytes);
  }
}
