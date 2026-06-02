import type {
  BootstrapOnboardingInput,
  OnboardingDiscovery,
  OnboardingStatus,
} from "@mosoo/contracts/account";
import type { OrganizationKind, OrganizationMemberRole } from "@mosoo/contracts/organization";
import {
  accountsTable,
  organizationDomainsTable,
  organizationMembersTable,
  organizationsTable,
} from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, asc, desc, eq, exists, gte, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getPublicEmailDomain } from "../../auth/domain/email-domain";
import { grantOrganizationMembership } from "../../organizations/application/organization-membership.service";
import { provisionOrganizationWithOwner } from "../../organizations/application/organization-provisioning.service";
import type { OrganizationSummaryRow } from "../../organizations/domain/organization-access.policy";
import { toOrganizationSummary } from "../../organizations/domain/organization-access.policy";
import { getOrganizationEmailDomain } from "../../organizations/domain/organization-domain-match";
import {
  enforceValidOrganizationKind,
  normalizeOrganizationKind,
  organizationKindValue,
} from "../../organizations/domain/organization-kind.policy";
import { normalizeOrganizationName } from "../../organizations/domain/organization-name";
import { deriveOrgName } from "../../users/domain/user-account.policy";
const NEW_ACCOUNT_WINDOW_MS = 30 * 1000;
const organizationCreatorAccountsTable = alias(accountsTable, "onboarding_org_creator_account");
const currentOnboardingMembersTable = alias(organizationMembersTable, "onboarding_current_member");
const currentOnboardingOrganizationsTable = alias(
  organizationsTable,
  "onboarding_current_organization",
);
const targetOnboardingOrganizationsTable = alias(
  organizationsTable,
  "onboarding_target_organization",
);
const targetOnboardingDomainsTable = alias(organizationDomainsTable, "onboarding_target_domain");

interface OnboardingDiscoveryRow {
  creator: string | null;
  id: OrganizationId | null;
  join_policy: OrganizationSummaryRow["join_policy"] | null;
  member_count: number;
  name: string | null;
}

interface OnboardingJoinBootstrapRow {
  current_avatar_url: string | null;
  current_created_at: number | null;
  current_id: OrganizationId | null;
  current_join_policy: OrganizationSummaryRow["join_policy"] | null;
  current_kind: OrganizationSummaryRow["kind"] | null;
  current_name: string | null;
  current_primary_domain: string | null;
  current_slug: string | null;
  current_viewer_role: OrganizationMemberRole | null;
  target_active_domain_id: string | null;
  target_avatar_url: string | null;
  target_created_at: number | null;
  target_id: OrganizationId | null;
  target_join_policy: OrganizationSummaryRow["join_policy"] | null;
  target_kind: OrganizationSummaryRow["kind"] | null;
  target_name: string | null;
  target_primary_domain: string | null;
  target_slug: string | null;
}

interface OnboardingJoinBootstrapSnapshot {
  currentStatus: OnboardingStatus;
  target: (OrganizationSummaryRow & { active_domain_id: string | null }) | null;
}

function derivePersonalOrganizationName(viewer: AuthenticatedViewer): string {
  return `${viewer.name}'s Sandbox`;
}

function resolveOnboardingOrganizationKind(
  viewer: AuthenticatedViewer,
  input: BootstrapOnboardingInput,
): OrganizationKind {
  const domain = viewer.email.split("@")[1]?.toLowerCase() ?? "";
  if (getPublicEmailDomain(domain)) {
    return "personal";
  }

  if (input.kind) {
    enforceValidOrganizationKind(input.kind);
    return input.kind;
  }

  throw new Error("Choose whether to create an organization or a Personal Org.");
}

function resolveOnboardingOrganizationName(
  viewer: AuthenticatedViewer,
  input: BootstrapOnboardingInput,
  kind: OrganizationKind,
): string {
  const requestedName = input.name?.trim();

  if (requestedName) {
    return normalizeOrganizationName(requestedName);
  }

  return kind === "personal"
    ? derivePersonalOrganizationName(viewer)
    : deriveOrgName(viewer.email, viewer.name);
}

function requireOnboardingJoinValue<T>(value: T | null, fieldName: string): T {
  if (value === null) {
    throw new Error(`Onboarding join snapshot is missing ${fieldName}.`);
  }

  return value;
}

function toCurrentOnboardingStatus(row: OnboardingJoinBootstrapRow): OnboardingStatus {
  if (row.current_id === null) {
    return {
      completed: false,
      organization: null,
    };
  }

  return {
    completed: true,
    organization: toOrganizationSummary({
      avatar_url: row.current_avatar_url,
      created_at: requireOnboardingJoinValue(row.current_created_at, "current_created_at"),
      id: row.current_id,
      join_policy: requireOnboardingJoinValue(row.current_join_policy, "current_join_policy"),
      kind: requireOnboardingJoinValue(row.current_kind, "current_kind"),
      name: requireOnboardingJoinValue(row.current_name, "current_name"),
      primary_domain: row.current_primary_domain,
      slug: requireOnboardingJoinValue(row.current_slug, "current_slug"),
      viewer_role: requireOnboardingJoinValue(row.current_viewer_role, "current_viewer_role"),
    }),
  };
}

function toOnboardingJoinTarget(
  row: OnboardingJoinBootstrapRow,
): (OrganizationSummaryRow & { active_domain_id: string | null }) | null {
  if (row.target_id === null) {
    return null;
  }

  return {
    active_domain_id: row.target_active_domain_id,
    avatar_url: row.target_avatar_url,
    created_at: requireOnboardingJoinValue(row.target_created_at, "target_created_at"),
    id: row.target_id,
    join_policy: requireOnboardingJoinValue(row.target_join_policy, "target_join_policy"),
    kind: requireOnboardingJoinValue(row.target_kind, "target_kind"),
    name: requireOnboardingJoinValue(row.target_name, "target_name"),
    primary_domain: row.target_primary_domain,
    slug: requireOnboardingJoinValue(row.target_slug, "target_slug"),
    viewer_role: "member",
  };
}

async function getOnboardingJoinBootstrapSnapshot(
  database: D1Database,
  input: {
    emailDomain: string;
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OnboardingJoinBootstrapSnapshot> {
  const row =
    (await getAppDatabase(database)
      .select({
        current_avatar_url: currentOnboardingOrganizationsTable.avatarUrl,
        current_created_at: currentOnboardingOrganizationsTable.createdAt,
        current_id: currentOnboardingOrganizationsTable.id,
        current_join_policy: currentOnboardingOrganizationsTable.joinPolicy,
        current_kind: organizationKindValue(currentOnboardingOrganizationsTable),
        current_name: currentOnboardingOrganizationsTable.name,
        current_primary_domain: currentOnboardingOrganizationsTable.primaryDomain,
        current_slug: currentOnboardingOrganizationsTable.slug,
        current_viewer_role: currentOnboardingMembersTable.role,
        target_active_domain_id: targetOnboardingDomainsTable.id,
        target_avatar_url: targetOnboardingOrganizationsTable.avatarUrl,
        target_created_at: targetOnboardingOrganizationsTable.createdAt,
        target_id: targetOnboardingOrganizationsTable.id,
        target_join_policy: targetOnboardingOrganizationsTable.joinPolicy,
        target_kind: organizationKindValue(targetOnboardingOrganizationsTable),
        target_name: targetOnboardingOrganizationsTable.name,
        target_primary_domain: targetOnboardingOrganizationsTable.primaryDomain,
        target_slug: targetOnboardingOrganizationsTable.slug,
      })
      .from(accountsTable)
      .leftJoin(
        currentOnboardingMembersTable,
        and(
          eq(currentOnboardingMembersTable.accountId, accountsTable.id),
          isNull(currentOnboardingMembersTable.disabledAt),
        ),
      )
      .leftJoin(
        currentOnboardingOrganizationsTable,
        eq(currentOnboardingOrganizationsTable.id, currentOnboardingMembersTable.organizationId),
      )
      .leftJoin(
        targetOnboardingOrganizationsTable,
        eq(targetOnboardingOrganizationsTable.id, input.organizationId),
      )
      .leftJoin(
        targetOnboardingDomainsTable,
        and(
          eq(targetOnboardingDomainsTable.organizationId, targetOnboardingOrganizationsTable.id),
          eq(targetOnboardingDomainsTable.domain, input.emailDomain),
          eq(targetOnboardingDomainsTable.status, "active"),
        ),
      )
      .where(eq(accountsTable.id, input.viewerId))
      .orderBy(desc(currentOnboardingMembersTable.joinedAt))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return {
      currentStatus: {
        completed: false,
        organization: null,
      },
      target: null,
    };
  }

  return {
    currentStatus: toCurrentOnboardingStatus(row),
    target: toOnboardingJoinTarget(row),
  };
}

export async function getOnboardingStatus(
  database: D1Database,
  viewer: AuthenticatedViewer | null,
): Promise<OnboardingStatus> {
  if (!viewer) {
    return {
      completed: false,
      organization: null,
    };
  }

  const row =
    (await getAppDatabase(database)
      .select({
        avatar_url: organizationsTable.avatarUrl,
        created_at: organizationsTable.createdAt,
        id: organizationsTable.id,
        join_policy: organizationsTable.joinPolicy,
        kind: organizationKindValue(),
        name: organizationsTable.name,
        primary_domain: organizationsTable.primaryDomain,
        slug: organizationsTable.slug,
        viewer_role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .where(
        and(
          eq(organizationMembersTable.accountId, viewer.id),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .orderBy(desc(organizationMembersTable.joinedAt))
      .limit(1)
      .get()) ?? null;

  return {
    completed: row !== null,
    organization: row === null ? null : toOrganizationSummary(row),
  };
}

export async function discoverOrganizations(
  database: D1Database,
  viewer: AuthenticatedViewer,
): Promise<OnboardingDiscovery> {
  const domain = viewer.email.split("@")[1]?.toLowerCase() ?? "";

  if (!domain || getPublicEmailDomain(domain)) {
    return {
      domain,
      isPublicEmail: true,
      orgs: [],
    };
  }

  const db = getAppDatabase(database);
  const discoveryCutoff = currentTimestampMs() - NEW_ACCOUNT_WINDOW_MS;
  const activeDomainMatch = db
    .select({ id: organizationDomainsTable.id })
    .from(organizationDomainsTable)
    .where(
      and(
        eq(organizationDomainsTable.organizationId, organizationsTable.id),
        eq(organizationDomainsTable.domain, domain),
        eq(organizationDomainsTable.status, "active"),
      ),
    );

  const results: OnboardingDiscoveryRow[] = await db
    .select({
      creator: sql<string | null>`COALESCE(${organizationCreatorAccountsTable.name}, 'Unknown')`,
      id: organizationsTable.id,
      join_policy: organizationsTable.joinPolicy,
      member_count: sql<number>`count(${organizationMembersTable.accountId})`,
      name: organizationsTable.name,
    })
    .from(accountsTable)
    .leftJoin(
      organizationsTable,
      and(or(eq(organizationsTable.primaryDomain, domain), exists(activeDomainMatch))),
    )
    .leftJoin(
      organizationCreatorAccountsTable,
      eq(organizationCreatorAccountsTable.id, organizationsTable.creatorAccountId),
    )
    .leftJoin(
      organizationMembersTable,
      and(
        eq(organizationMembersTable.organizationId, organizationsTable.id),
        isNull(organizationMembersTable.disabledAt),
      ),
    )
    .where(and(eq(accountsTable.id, viewer.id), gte(accountsTable.createdAt, discoveryCutoff)))
    .groupBy(organizationsTable.id)
    .orderBy(asc(organizationsTable.createdAt))
    .all();

  if (results.length === 0) {
    return {
      domain,
      isPublicEmail: false,
      orgs: [],
    };
  }

  return {
    domain,
    isPublicEmail: false,
    orgs: results.flatMap((row) => {
      if (row.id === null || row.join_policy === null || row.name === null) {
        return [];
      }

      return [
        {
          creator: row.creator ?? "Unknown",
          id: row.id,
          joinPolicy: row.join_policy,
          memberCount: row.member_count,
          name: row.name,
        },
      ];
    }),
  };
}

export async function bootstrapOnboarding(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: BootstrapOnboardingInput,
): Promise<OnboardingStatus> {
  if (input.action === "join") {
    if (!isTruthy(input.organizationId)) {
      throw new Error("Organization id is required.");
    }

    const emailDomain = getOrganizationEmailDomain(viewer.email);
    const snapshot = await getOnboardingJoinBootstrapSnapshot(database, {
      emailDomain,
      organizationId: input.organizationId,
      viewerId: viewer.id,
    });

    if (snapshot.currentStatus.completed) {
      return snapshot.currentStatus;
    }

    const organization = snapshot.target;

    if (!organization) {
      throw new Error("Organization not found.");
    }

    if (organization.join_policy !== "auto") {
      throw new Error("This organization requires an invite.");
    }

    if (organization.kind === "personal") {
      throw new Error("Personal Orgs do not accept new members.");
    }

    if (organization.primary_domain !== emailDomain && organization.active_domain_id === null) {
      throw forbiddenError("Your email domain does not match this organization.");
    }

    await grantOrganizationMembership(database, {
      accountId: viewer.id,
      makeActive: true,
      organizationKind: organization.kind,
      organizationId: input.organizationId,
      role: "member",
    });

    return {
      completed: true,
      organization: toOrganizationSummary(organization),
    };
  }

  const currentStatus = await getOnboardingStatus(database, viewer);

  if (currentStatus.completed) {
    return currentStatus;
  }

  const kind = normalizeOrganizationKind(resolveOnboardingOrganizationKind(viewer, input));
  const organizationName = resolveOnboardingOrganizationName(viewer, input, kind);

  const organization = await provisionOrganizationWithOwner(database, viewer, {
    kind,
    makeActive: true,
    name: organizationName,
  });

  return {
    completed: true,
    organization,
  };
}
