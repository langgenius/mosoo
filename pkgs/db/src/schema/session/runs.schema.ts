import type { SkillMaterializationStatus, SkillResolutionMode } from "@mosoo/contracts/skill";
import type { SessionRunId, SkillId, SkillSnapshotId } from "@mosoo/id";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "../id-column";
import { defineSessionRunsTable } from "./session-run-table";

export const sessionRunsTable = defineSessionRunsTable({});

export const sessionRunSkillsTable = sqliteTable(
  "session_run_skill",
  {
    blobSha256: text("blob_sha256"),
    createdAt: integer("created_at").notNull(),
    materializationStatus: text("materialization_status")
      .$type<SkillMaterializationStatus>()
      .notNull(),
    mountPath: text("mount_path").notNull(),
    resolutionMode: text("resolution_mode").$type<SkillResolutionMode>().notNull(),
    sessionRunId: platformIdColumn<SessionRunId>("session_run_id")
      .notNull()
      .references(() => sessionRunsTable.id, { onDelete: "cascade" }),
    skillId: platformIdColumn<SkillId>("skill_id").notNull(),
    skillName: text("skill_name").notNull(),
    snapshotId: platformIdColumn<SkillSnapshotId>("snapshot_id"),
    updatedAt: integer("updated_at").notNull(),
    warningCode: text("warning_code"),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionRunId, table.skillId],
    }),
    index("session_run_skill_run_resolution_idx").on(table.sessionRunId, table.resolutionMode),
  ],
);

export type SessionRunRow = typeof sessionRunsTable.$inferSelect;
export type SessionRunSkillRow = typeof sessionRunSkillsTable.$inferSelect;
