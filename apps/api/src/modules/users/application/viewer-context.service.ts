import type {
  AccountProfile,
  SetSystemAgentModelInput,
  SystemAgentModelSetting,
  UpdateAccountProfileInput,
  Viewer,
  ViewerAuth,
} from "@mosoo/contracts/account";
import type { AuthMethod, AuthSecurityLevel } from "@mosoo/contracts/auth";
import { accountsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { SYSTEM_AGENT_RUNTIME_ID } from "@mosoo/runtime-catalog";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getOrganizationCreationSlotStatus } from "../../organizations/domain/organization-kind.policy";
import { ensureModelAvailableForSelection } from "../../vendor-credentials/application/available-models";
import { normalizeAccountImageUrl } from "../domain/user-avatar";
import { normalizeAccountName } from "../domain/user-name";
import {
  listViewerOrganizationMemberships,
  resolveActiveOrganization,
  resolveViewerOrganizationContextFromState,
} from "./account-organization-context.service";

interface ViewerAccountState {
  id: AccountId;
  imageUrl: string | null;
  lastActiveOrganizationId: OrganizationId | null;
  name: string;
  systemAgentModel: SystemAgentModelSetting | null;
}

function parseSystemAgentModel(value: unknown): SystemAgentModelSetting | null {
  if (!isTruthy(value)) {
    return null;
  }

  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as { vendor?: unknown }).vendor !== "string" ||
    typeof (parsed as { modelId?: unknown }).modelId !== "string"
  ) {
    throw new Error("Stored system agent model must be a model setting object.");
  }

  return {
    modelId: (parsed as { modelId: string }).modelId,
    vendor: (parsed as { vendor: string }).vendor,
  };
}

function createAccountProfile(
  viewer: AuthenticatedViewer,
  systemAgentModel: SystemAgentModelSetting | null,
): AccountProfile {
  return {
    email: viewer.email,
    id: viewer.id,
    imageUrl: viewer.imageUrl,
    name: viewer.name,
    systemAgentModel,
  };
}

export async function getSystemAgentModel(
  database: D1Database,
  accountId: AccountId,
): Promise<SystemAgentModelSetting | null> {
  const row =
    (await getAppDatabase(database)
      .select({ system_agent_model: accountsTable.systemAgentModel })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Account not found.");
  }

  return parseSystemAgentModel(row.system_agent_model);
}

async function getViewerAccountState(
  database: D1Database,
  accountId: AccountId,
): Promise<ViewerAccountState> {
  const row =
    (await getAppDatabase(database)
      .select({
        id: accountsTable.id,
        image: accountsTable.image,
        lastActiveOrganizationId: accountsTable.lastActiveOrganizationId,
        name: accountsTable.name,
        systemAgentModel: accountsTable.systemAgentModel,
      })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Account not found.");
  }

  return {
    id: row.id,
    imageUrl: row.image,
    lastActiveOrganizationId: row.lastActiveOrganizationId,
    name: row.name,
    systemAgentModel: parseSystemAgentModel(row.systemAgentModel),
  };
}

function getViewerAuth(bindings: ApiBindings, viewer: AuthenticatedViewer | null): ViewerAuth {
  const methods: AuthMethod[] = ["email_otp"];
  const authBindings = bindings as ApiBindings & {
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
  };

  if (
    authBindings.GOOGLE_OAUTH_CLIENT_ID?.trim() !== null &&
    authBindings.GOOGLE_OAUTH_CLIENT_ID?.trim() !== undefined &&
    authBindings.GOOGLE_OAUTH_CLIENT_ID?.trim() !== "" &&
    authBindings.GOOGLE_OAUTH_CLIENT_SECRET?.trim() !== null &&
    authBindings.GOOGLE_OAUTH_CLIENT_SECRET?.trim() !== undefined &&
    authBindings.GOOGLE_OAUTH_CLIENT_SECRET?.trim() !== ""
  ) {
    methods.push("google_oauth");
  }

  const currentSecurityLevel: AuthSecurityLevel =
    viewer?.emailVerified === true ? "verified_email" : "basic";

  return {
    currentSecurityLevel,
    methods,
  };
}

export async function getViewer(
  database: D1Database,
  bindings: ApiBindings,
  viewer: AuthenticatedViewer | null,
): Promise<Viewer> {
  if (!viewer) {
    return {
      account: null,
      activeOrganization: null,
      auth: getViewerAuth(bindings, null),
      memberships: [],
      organizationCreationSlot: { occupied: false, organizationId: null },
    };
  }

  const [accountState, memberships, organizationCreationSlot] = await Promise.all([
    getViewerAccountState(database, viewer.id),
    listViewerOrganizationMemberships(database, viewer.id),
    getOrganizationCreationSlotStatus(database, viewer.id),
  ]);
  const organizationContext = await resolveViewerOrganizationContextFromState(
    database,
    accountState,
    memberships,
  );

  return {
    account: createAccountProfile(
      { ...viewer, imageUrl: accountState.imageUrl, name: accountState.name },
      accountState.systemAgentModel,
    ),
    activeOrganization: organizationContext.activeOrganization,
    auth: getViewerAuth(bindings, viewer),
    memberships: organizationContext.memberships,
    organizationCreationSlot,
  };
}

export async function updateProfile(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateAccountProfileInput,
): Promise<AccountProfile> {
  const timestampMs = currentTimestampMs();
  const name = normalizeAccountName(input.name);
  const imageProvided = Object.prototype.hasOwnProperty.call(input, "imageUrl");
  const imageUrl = imageProvided ? normalizeAccountImageUrl(input.imageUrl) : viewer.imageUrl;

  const updates: { image?: string | null; name: string; updatedAt: number } = {
    name,
    updatedAt: timestampMs,
  };

  if (imageProvided) {
    updates.image = imageUrl;
  }

  const updated =
    (await getAppDatabase(database)
      .update(accountsTable)
      .set(updates)
      .where(eq(accountsTable.id, viewer.id))
      .returning({ systemAgentModel: accountsTable.systemAgentModel })
      .get()) ?? null;

  if (updated === null) {
    throw new Error("Account not found.");
  }

  return createAccountProfile(
    { ...viewer, imageUrl, name },
    parseSystemAgentModel(updated.systemAgentModel),
  );
}

export async function setSystemAgentModel(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SetSystemAgentModelInput,
): Promise<AccountProfile> {
  const activeOrganization = await resolveActiveOrganization(database, viewer.id);

  if (!activeOrganization) {
    throw new Error("Active organization is required.");
  }

  const systemAgentModel: SystemAgentModelSetting = {
    modelId: input.modelId.trim(),
    vendor: input.vendor.trim(),
  };

  await ensureModelAvailableForSelection(database, {
    accountId: viewer.id,
    modelId: systemAgentModel.modelId,
    organizationId: activeOrganization.id,
    runtimeId: SYSTEM_AGENT_RUNTIME_ID,
    vendorId: systemAgentModel.vendor,
  });

  const updated =
    (await getAppDatabase(database)
      .update(accountsTable)
      .set({
        systemAgentModel,
        updatedAt: currentTimestampMs(),
      })
      .where(eq(accountsTable.id, viewer.id))
      .returning({ id: accountsTable.id })
      .get()) ?? null;

  if (updated === null) {
    throw new Error("Account not found.");
  }

  return createAccountProfile(viewer, systemAgentModel);
}
