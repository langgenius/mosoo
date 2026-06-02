import type { OrganizationKind, OrganizationMemberRole } from "@mosoo/contracts/organization";
import { organizationMembersTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { recordLastActiveOrganization } from "../../users/application/account-organization-context.service";
import {
  enforceOrganizationAcceptsCollaborators,
  enforceOrganizationKindAcceptsCollaborators,
} from "../domain/organization-kind.policy";

interface GrantOrganizationMembershipInput {
  accountId: AccountId;
  makeActive?: boolean;
  organizationKind?: OrganizationKind;
  role: Exclude<OrganizationMemberRole, "owner">;
  organizationId: OrganizationId;
}

export async function grantOrganizationMembership(
  database: D1Database,
  input: GrantOrganizationMembershipInput,
): Promise<{ organizationId: OrganizationId }> {
  if (input.organizationKind === undefined) {
    await enforceOrganizationAcceptsCollaborators(database, input.organizationId);
  } else {
    enforceOrganizationKindAcceptsCollaborators(input.organizationKind);
  }

  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .insert(organizationMembersTable)
    .values({
      accountId: input.accountId,
      createdAt: timestampMs,
      joinedAt: timestampMs,
      organizationId: input.organizationId,
      role: input.role,
    })
    .onConflictDoUpdate({
      set: {
        disabledAt: null,
        disabledByAccountId: null,
        joinedAt: organizationMembersTable.joinedAt,
        role: sql<OrganizationMemberRole>`
          CASE
            WHEN ${organizationMembersTable.role} = 'owner' THEN ${organizationMembersTable.role}
            ELSE excluded.role
          END
        `,
      },
      target: [organizationMembersTable.organizationId, organizationMembersTable.accountId],
    })
    .run();

  if (input.makeActive === true) {
    await recordLastActiveOrganization(database, input.accountId, input.organizationId);
  }

  return {
    organizationId: input.organizationId,
  };
}
