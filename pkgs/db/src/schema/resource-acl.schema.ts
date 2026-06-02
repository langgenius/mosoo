import type {
  AccountId,
  AgentId,
  EnvironmentId,
  OrganizationId,
  SkillId,
  SpaceId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export type ResourceAclResourceType = "agent" | "environment" | "skill" | "space";
export type ResourceAclResourceId = AgentId | EnvironmentId | SkillId | SpaceId;
export type ResourceAclTargetId = AccountId | OrganizationId;
export type ResourceAclTargetKind = "organization" | "user";

export const resourceAclTable = sqliteTable(
  "resource_acl",
  {
    assignedByAccountId: platformIdColumn<AccountId>("assigned_by_account_id"),
    createdAt: integer("created_at").notNull(),
    resourceId: platformIdColumn<ResourceAclResourceId>("resource_id").notNull(),
    resourceType: text("resource_type").$type<ResourceAclResourceType>().notNull(),
    role: text("role").notNull(),
    targetId: platformIdColumn<ResourceAclTargetId>("target_id").notNull(),
    targetKind: text("target_kind").$type<ResourceAclTargetKind>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.resourceType, table.resourceId, table.targetKind, table.targetId],
    }),
    check(
      "resource_acl_resource_type_check",
      sql`${table.resourceType} IN ('agent', 'environment', 'skill', 'space')`,
    ),
    check("resource_acl_target_kind_check", sql`${table.targetKind} IN ('organization', 'user')`),
    index("resource_acl_target_idx").on(table.targetKind, table.targetId),
    index("resource_acl_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export type ResourceAclRow = typeof resourceAclTable.$inferSelect;
