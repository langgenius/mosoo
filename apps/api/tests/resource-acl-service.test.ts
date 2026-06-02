import { describe, expect, test } from "bun:test";

import {
  deleteResourceAcl,
  insertResourceAclIfAbsent,
  toOrganizationAclTarget,
  toUserAclTarget,
  updateResourceAclRole,
} from "../src/modules/resource-access/application/resource-acl.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createResourceAclDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE resource_acl (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      role text NOT NULL,
      assigned_by_account_id text,
      created_at integer NOT NULL,
      PRIMARY KEY (resource_type, resource_id, target_kind, target_id)
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE skill (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE space (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    ) VALUES
      ('01J00000000000000000000006', 'admin-1', 'admin', NULL),
      ('01J00000000000000000000006', 'admin-2', 'admin', NULL),
      ('01J00000000000000000000006', '01J00000000000000000000002', 'member', NULL),
      ('01J00000000000000000000006', '01J00000000000000000000003', 'member', 1),
      ('01J00000000000000000000007', '01J00000000000000000000004', 'member', NULL);

    INSERT INTO agent (id, organization_id)
    VALUES ('01J00000000000000000000009', '01J00000000000000000000006');
  `);

  return database;
}

describe("resource ACL service", () => {
  test("returns inserted assignment metadata", async () => {
    const database = createResourceAclDatabase();

    const metadata = await insertResourceAclIfAbsent(database, {
      assignedByAccountId: "admin-1",
      createdAt: 1,
      resourceId: "01J00000000000000000000009",
      resourceType: "agent",
      role: "user",
      target: toUserAclTarget("01J00000000000000000000002"),
    });

    expect(metadata).toEqual({
      assignedByAccountId: "admin-1",
      createdAt: 1,
    });
    await expect(
      database
        .prepare("SELECT assigned_by_account_id, created_at FROM resource_acl WHERE target_id = ?")
        .bind("01J00000000000000000000002")
        .first(),
    ).resolves.toEqual({
      assigned_by_account_id: "admin-1",
      created_at: 1,
    });
  });

  test("returns existing assignment metadata when insert conflicts", async () => {
    const database = createResourceAclDatabase();

    await insertResourceAclIfAbsent(database, {
      assignedByAccountId: "admin-1",
      createdAt: 1,
      resourceId: "01J00000000000000000000009",
      resourceType: "agent",
      role: "user",
      target: toUserAclTarget("01J00000000000000000000002"),
    });

    const metadata = await insertResourceAclIfAbsent(database, {
      assignedByAccountId: "admin-2",
      createdAt: 2,
      resourceId: "01J00000000000000000000009",
      resourceType: "agent",
      role: "admin",
      target: toUserAclTarget("01J00000000000000000000002"),
    });

    expect(metadata).toEqual({
      assignedByAccountId: "admin-1",
      createdAt: 1,
    });
    await expect(
      database
        .prepare(
          "SELECT assigned_by_account_id, created_at, role FROM resource_acl WHERE target_id = ?",
        )
        .bind("01J00000000000000000000002")
        .first(),
    ).resolves.toEqual({
      assigned_by_account_id: "admin-1",
      created_at: 1,
      role: "user",
    });
  });

  test("throws when updating a missing assignment", async () => {
    const database = createResourceAclDatabase();

    await expect(
      updateResourceAclRole(database, {
        assignedByAccountId: "admin-1",
        createdAt: 2,
        resourceId: "01J00000000000000000000009",
        resourceType: "agent",
        role: "admin",
        target: toUserAclTarget("01J00000000000000000000002"),
      }),
    ).rejects.toThrow();
  });

  test("throws when deleting a missing assignment", async () => {
    const database = createResourceAclDatabase();

    await expect(
      deleteResourceAcl(database, {
        resourceId: "space-1",
        resourceType: "space",
        target: toUserAclTarget("01J00000000000000000000002"),
      }),
    ).rejects.toThrow();
  });

  test("updates and deletes existing assignments", async () => {
    const database = createResourceAclDatabase();

    await insertResourceAclIfAbsent(database, {
      assignedByAccountId: "admin-1",
      createdAt: 1,
      resourceId: "01J00000000000000000000009",
      resourceType: "agent",
      role: "user",
      target: toUserAclTarget("01J00000000000000000000002"),
    });

    await updateResourceAclRole(database, {
      assignedByAccountId: "admin-2",
      createdAt: 2,
      resourceId: "01J00000000000000000000009",
      resourceType: "agent",
      role: "admin",
      target: toUserAclTarget("01J00000000000000000000002"),
    });

    const updated = await database
      .prepare(
        `
          SELECT assigned_by_account_id, created_at, role
          FROM resource_acl
          WHERE resource_type = 'agent'
            AND resource_id = '01J00000000000000000000009'
            AND target_kind = 'user'
            AND target_id = '01J00000000000000000000002'
        `,
      )
      .first<{
        assigned_by_account_id: string;
        created_at: number;
        role: string;
      }>();

    expect(updated).toEqual({
      assigned_by_account_id: "admin-2",
      created_at: 2,
      role: "admin",
    });

    await deleteResourceAcl(database, {
      resourceId: "01J00000000000000000000009",
      resourceType: "agent",
      target: toUserAclTarget("01J00000000000000000000002"),
    });

    const deleted = await database
      .prepare(
        "SELECT target_id FROM resource_acl WHERE resource_id = '01J00000000000000000000009'",
      )
      .first();

    expect(deleted).toBeNull();
  });

  test("rejects inactive user ACL targets", async () => {
    const database = createResourceAclDatabase();

    await expect(
      insertResourceAclIfAbsent(database, {
        assignedByAccountId: "admin-1",
        createdAt: 1,
        resourceId: "01J00000000000000000000009",
        resourceType: "agent",
        role: "user",
        target: toUserAclTarget("01J00000000000000000000003"),
      }),
    ).rejects.toThrow();
  });

  test("rejects cross-organization user ACL targets", async () => {
    const database = createResourceAclDatabase();

    await expect(
      insertResourceAclIfAbsent(database, {
        assignedByAccountId: "admin-1",
        createdAt: 1,
        resourceId: "01J00000000000000000000009",
        resourceType: "agent",
        role: "user",
        target: toUserAclTarget("01J00000000000000000000004"),
      }),
    ).rejects.toThrow();
  });

  test("rejects cross-organization ACL targets", async () => {
    const database = createResourceAclDatabase();

    await expect(
      insertResourceAclIfAbsent(database, {
        assignedByAccountId: "admin-1",
        createdAt: 1,
        resourceId: "01J00000000000000000000009",
        resourceType: "agent",
        role: "user",
        target: toOrganizationAclTarget("01J00000000000000000000007"),
      }),
    ).rejects.toThrow();
  });
});
