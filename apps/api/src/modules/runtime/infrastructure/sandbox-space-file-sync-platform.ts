import type { RuntimeSpaceMountPath } from "@mosoo/driver-protocol";

import { SANDBOX_SPACE_ANCHOR_FILE_NAME } from "../domain/sandbox-layout";
import type { ExecutionSessionHandle } from "./sandbox-handles";

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function listSandboxSpaceFilePaths(
  handle: ExecutionSessionHandle,
  rootPath: RuntimeSpaceMountPath,
): Promise<string[]> {
  const quotedRootPath = quoteShellArg(rootPath);
  const command = [
    `if [ ! -d ${quotedRootPath} ]; then exit 0; fi`,
    `find ${quotedRootPath} -type f ! -name ${quoteShellArg(SANDBOX_SPACE_ANCHOR_FILE_NAME)} -print`,
  ].join(" && ");
  const result = await handle.exec(`sh -lc ${quoteShellArg(command)}`);

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Failed to list sandbox space files at ${rootPath}.`,
    );
  }

  return result.stdout.split("\n").filter((path) => path.length > 0);
}
