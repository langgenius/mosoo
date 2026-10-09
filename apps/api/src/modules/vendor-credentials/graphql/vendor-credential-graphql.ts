import type { ProjectId } from "@mosoo/id";

import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { isTruthy } from "../../../shared/truthiness";
import { resolveAvailableModelsForViewer } from "../application/available-models";
import {
  createVendorCredential,
  deleteVendorCredential,
  setDefaultVendorCredential,
  updateVendorCredential,
} from "../application/vendor-credential-commands";
import { listVendorCredentials } from "../application/vendor-credential-list";
import { testVendorCredential } from "../application/vendor-credential-test";

interface VendorCredentialsArgs {
  projectId: ProjectId;
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

interface SetDefaultVendorCredentialArgs {
  input: Parameters<typeof setDefaultVendorCredential>[2];
}

interface AvailableAgentModelsArgs {
  currentModelId?: string | null;
  currentVendorId?: string | null;
  projectId: ProjectId;
  runtimeId: string;
}

interface TestVendorCredentialArgs {
  input: Parameters<typeof testVendorCredential>[2];
}

export const vendorCredentialGraphQLModule = {
  authenticatedMutationResolvers: {
    createVendorCredential: async (_parent, args: CreateVendorCredentialArgs, context) =>
      createVendorCredential(context.bindings, context.viewer, args.input),
    deleteVendorCredential: async (_parent, args: DeleteVendorCredentialArgs, context) => {
      await deleteVendorCredential(context.bindings, context.viewer, args.input);
      return { ok: true };
    },
    setDefaultVendorCredential: async (_parent, args: SetDefaultVendorCredentialArgs, context) =>
      setDefaultVendorCredential(context.bindings, context.viewer, args.input),
    testVendorCredential: async (_parent, args: TestVendorCredentialArgs, context) =>
      testVendorCredential(context.bindings, context.viewer, args.input),
    updateVendorCredential: async (_parent, args: UpdateVendorCredentialArgs, context) =>
      updateVendorCredential(context.bindings, context.viewer, args.input),
  },
  authenticatedQueryResolvers: {
    availableAgentModels: async (_parent, args: AvailableAgentModelsArgs, context) =>
      resolveAvailableModelsForViewer(context.bindings.DB, context.viewer, {
        ...(isTruthy(args.currentModelId) ? { currentModelId: args.currentModelId } : {}),
        ...(isTruthy(args.currentVendorId) ? { currentVendorId: args.currentVendorId } : {}),
        projectId: args.projectId,
        runtimeId: args.runtimeId,
      }),
    vendorCredentialList: async (_parent, args: VendorCredentialsArgs, context) =>
      listVendorCredentials(context.bindings, context.viewer, args.projectId),
  },
} satisfies GraphQLModule;
