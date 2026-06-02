import { parsePlatformId } from "@mosoo/id";
import type { OrganizationId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { vendorCredentialGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { isTruthy } from "../../../shared/truthiness";
import {
  createVendorCredential,
  deleteVendorCredential,
  getCredentialPolicy,
  listVendorCredentialCapabilities,
  listVendorCredentials,
  resolveAvailableModelsForViewer,
  testVendorCredential,
  updateCredentialPolicy,
  updateVendorCredential,
} from "../application/vendor-credential.service";

interface VendorCredentialsArgs {
  organizationId: string;
}

interface CreateVendorCredentialArgs {
  input: Parameters<typeof createVendorCredential>[2];
}

interface UpdateVendorCredentialArgs {
  input: Parameters<typeof updateVendorCredential>[2];
}

interface DeleteVendorCredentialArgs {
  input: Parameters<typeof deleteVendorCredential>[2];
}

interface UpdateCredentialPolicyArgs {
  input: Parameters<typeof updateCredentialPolicy>[2];
}

interface AvailableAgentModelsArgs {
  currentModelId?: string | null;
  currentVendorId?: string | null;
  runtimeId: string;
}

interface TestVendorCredentialArgs {
  input: Parameters<typeof testVendorCredential>[2];
}

function parseOrganizationId(value: string): OrganizationId {
  return parsePlatformId<OrganizationId>(value, "Organization ID");
}

export const vendorCredentialGraphQLModule = {
  ...vendorCredentialGraphQLSpec,
  authenticatedMutationResolvers: {
    createVendorCredential: async (_parent, args: CreateVendorCredentialArgs, context) =>
      createVendorCredential(context.bindings, context.viewer, args.input),
    deleteVendorCredential: async (_parent, args: DeleteVendorCredentialArgs, context) => {
      await deleteVendorCredential(context.bindings, context.viewer, args.input);
      return { ok: true };
    },
    testVendorCredential: async (_parent, args: TestVendorCredentialArgs, context) =>
      testVendorCredential(context.bindings, context.viewer, args.input),
    updateCredentialPolicy: async (_parent, args: UpdateCredentialPolicyArgs, context) =>
      updateCredentialPolicy(context.bindings.DB, context.viewer, args.input),
    updateVendorCredential: async (_parent, args: UpdateVendorCredentialArgs, context) =>
      updateVendorCredential(context.bindings, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    availableAgentModels: async (_parent, args: AvailableAgentModelsArgs, context) =>
      resolveAvailableModelsForViewer(context.bindings.DB, context.viewer, {
        ...(isTruthy(args.currentModelId) ? { currentModelId: args.currentModelId } : {}),
        ...(isTruthy(args.currentVendorId) ? { currentVendorId: args.currentVendorId } : {}),
        runtimeId: args.runtimeId,
      }),
    credentialPolicy: async (_parent, args: VendorCredentialsArgs, context) =>
      getCredentialPolicy(
        context.bindings.DB,
        context.viewer,
        parseOrganizationId(args.organizationId),
      ),
    vendorCredentialCapabilities: async (_parent, args: VendorCredentialsArgs, context) =>
      listVendorCredentialCapabilities(
        context.bindings.DB,
        context.viewer,
        parseOrganizationId(args.organizationId),
      ),
    vendorCredentialList: async (_parent, args: VendorCredentialsArgs, context) =>
      listVendorCredentials(
        context.bindings,
        context.viewer,
        parseOrganizationId(args.organizationId),
      ),
  },
} satisfies GraphQLModule;
