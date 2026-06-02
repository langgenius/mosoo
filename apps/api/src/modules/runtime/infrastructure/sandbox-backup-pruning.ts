import type { ReadySandboxBackupForPruning } from "./sandbox-backup-store";

export function selectSandboxBackupPruneIds(
  backups: readonly ReadySandboxBackupForPruning[],
): string[] {
  const keepIds = new Set<string>();
  const readyCountsByDir = new Map<string, number>();

  for (const backup of backups) {
    if (backup.keep) {
      keepIds.add(backup.id);
      continue;
    }

    const readyCount = (readyCountsByDir.get(backup.dir) ?? 0) + 1;
    readyCountsByDir.set(backup.dir, readyCount);

    if (readyCount <= 3) {
      keepIds.add(backup.id);
    }
  }

  return backups.flatMap((backup) => (keepIds.has(backup.id) ? [] : [backup.id]));
}
