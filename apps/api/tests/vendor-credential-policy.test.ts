import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { listVendorCredentialCapabilities } from "../src/modules/vendor-credentials/application/vendor-credential-policy.service";
import {
  parseAllowedProviderIds,
  serializeAllowedProviderIds,
} from "../src/modules/vendor-credentials/application/vendor-credential.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: "01J00000000000000000000002",
  imageUrl: null,
  name: "Member",
};

function createCredentialPolicyDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      avatar_url text,
      byok_allowed_providers text,
      byok_enabled integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL,
      creator_account_id text,
      default_environment_id text,
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL,
      kind text DEFAULT 'team' NOT NULL,
      name text NOT NULL,
      primary_domain text,
      slug text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_member (
      account_id text NOT NULL,
      created_at integer NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      joined_at integer NOT NULL,
      organization_id text NOT NULL,
      role text NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    INSERT INTO organization (
      avatar_url,
      byok_allowed_providers,
      byok_enabled,
      created_at,
      creator_account_id,
      default_environment_id,
      id,
      join_policy,
      kind,
      name,
      primary_domain,
      slug,
      updated_at
    )
    VALUES (
      NULL,
      'openai',
      1,
      1,
      '01J00000000000000000000001',
      NULL,
      '01J00000000000000000000006',
      'invite_only',
      'team',
      'Acme',
      NULL,
      'acme',
      1
    );

    INSERT INTO organization_member (
      account_id,
      created_at,
      disabled_at,
      disabled_by_account_id,
      joined_at,
      organization_id,
      role
    )
    VALUES (
      '01J00000000000000000000002',
      1,
      NULL,
      NULL,
      1,
      '01J00000000000000000000006',
      'member'
    );
  `);

  return database;
}

describe("vendor credential policy", () => {
  test("admits only catalog provider ids", () => {
    expect(parseAllowedProviderIds(" openai,anthropic ")).toEqual(["openai", "anthropic"]);
    expect(serializeAllowedProviderIds(["openai", "anthropic"])).toBe("openai,anthropic");
    expect(() => parseAllowedProviderIds("openai,unknown-provider")).toThrow();
    expect(() => serializeAllowedProviderIds(["unknown-provider"])).toThrow();
  });

  test("loads capabilities from membership and organization policy", async () => {
    const database = createCredentialPolicyDatabase();

    const capabilities = await listVendorCredentialCapabilities(
      database,
      VIEWER,
      "01J00000000000000000000006",
    );

    expect(capabilities.find((capability) => capability.vendorId === "openai")).toMatchObject({
      personalCredentialAllowed: true,
      providerAllowed: true,
    });
    expect(capabilities.find((capability) => capability.vendorId === "anthropic")).toMatchObject({
      personalCredentialAllowed: false,
      providerAllowed: false,
    });
  });
});
