import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { deleteSandboxBackupObjects } from "./sandbox-backup-platform";
import {
  deleteSandboxBackupRecordsForDir,
  listSandboxBackupIdsByDir,
} from "./sandbox-backup-store";

export async function deleteSandboxBackupsForDir(
  bindings: ApiBindings,
  input: {
    dir: string;
  },
): Promise<void> {
  const backupIds = await listSandboxBackupIdsByDir(bindings.DB, input.dir);

  await deleteSandboxBackupObjects(bindings, backupIds);
  await deleteSandboxBackupRecordsForDir(bindings.DB, input.dir);
}
