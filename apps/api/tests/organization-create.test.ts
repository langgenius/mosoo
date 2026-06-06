import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createOrganization } from "../src/modules/organizations/application/organization.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createOrganizationCreateDatabase(currentViewer: AuthenticatedViewer): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      email_verified integer NOT NULL,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      join_policy text NOT NULL,
      primary_domain text,
      avatar_url text,
      creator_account_id text,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX organization_slug_idx ON organization (slug);

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      created_at integer NOT NULL,
      joined_at integer NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text,
      current_revision_id text NOT NULL,
      forked_from_environment_id text,
      forked_from_environment_name text,
      forked_from_owner_name text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE environment_revision (
      id text PRIMARY KEY NOT NULL,
      environment_id text NOT NULL,
      organization_id text NOT NULL,
      network_policy text NOT NULL,
      allow_mcp_servers integer NOT NULL,
      allow_package_managers integer NOT NULL,
      allowed_hosts_json text NOT NULL,
      packages_json text NOT NULL,
      setup_script text NOT NULL,
      env_vars_json text NOT NULL,
      created_by_account_id text,
      created_at integer NOT NULL
    );

    INSERT INTO account (
      id,
      email,
      email_verified,
      image_url,
      last_active_organization_id,
      name,
      system_agent_model,
      created_at,
      updated_at
    )
    VALUES (
      '${currentViewer.id}',
      '${currentViewer.email}',
      ${currentViewer.emailVerified ? 1 : 0},
      NULL,
      NULL,
      '${currentViewer.name}',
      NULL,
      1,
      1
    );
  `);

  return database;
}

function makeViewer(email: string): AuthenticatedViewer {
  return {
    email,
    emailVerified: true,
    id: "account-1",
    imageUrl: null,
    name: "New User",
  };
}

describe("organization creation", () => {
  test("creates an organization", async () => {
    const currentViewer = makeViewer("new@example.com");
    const database = createOrganizationCreateDatabase(currentViewer);

    const organization = await createOrganization(database, currentViewer, {
      name: "Explicit Team",
    });

    expect(organization).toMatchObject({
      joinPolicy: "auto",
      name: "Explicit Team",
      slug: "explicit-team",
      viewerRole: "owner",
    });
  });

  test("creates first public-email organization through the same path", async () => {
    const currentViewer = makeViewer("new@gmail.com");
    const database = createOrganizationCreateDatabase(currentViewer);

    const organization = await createOrganization(database, currentViewer, {
      name: "Requested Team",
    });

    expect(organization).toMatchObject({
      joinPolicy: "auto",
      name: "Requested Team",
      slug: "requested-team",
      viewerRole: "owner",
    });
  });

  test("retries slug conflicts without leaking a creation slot", async () => {
    const currentViewer = makeViewer("new@example.com");
    const database = createOrganizationCreateDatabase(currentViewer);
    database.execute(`
      INSERT INTO organization (
        id,
        name,
        slug,
        join_policy,
        creator_account_id,
        created_at,
        updated_at
      )
      VALUES (
        'existing-org',
        'Dify',
        'dify',
        'auto',
        'existing-account',
        1,
        1
      );
    `);

    const organization = await createOrganization(database, currentViewer, {
      name: "dify",
    });

    const createdRows = await database
      .prepare("SELECT id, slug FROM organization WHERE creator_account_id = ? ORDER BY slug")
      .bind(currentViewer.id)
      .all<{ id: string; slug: string }>();

    expect(organization).toMatchObject({
      id: organization.id,
      name: "dify",
      slug: "dify-2",
    });
    expect(createdRows.results).toEqual([
      {
        id: organization.id,
        slug: "dify-2",
      },
    ]);
  });

  test("raises a typed domain error when the CE self-created organization slot is occupied", async () => {
    const currentViewer = makeViewer("new@example.com");
    const database = createOrganizationCreateDatabase(currentViewer);

    await createOrganization(database, currentViewer, {
      name: "First Team",
    });

    await expect(
      createOrganization(database, currentViewer, {
        name: "Second Team",
      }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_CREATION_SLOT_OCCUPIED",
      status: 400,
    });

    await expect(
      createOrganization(database, currentViewer, {
        name: "Third Team",
      }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_CREATION_SLOT_OCCUPIED",
      status: 400,
    });
  });
});
