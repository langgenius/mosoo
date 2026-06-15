import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { onboardingGraphQLSpec } from "../../../adapters/graphql/graphql-module-specs";
import { bootstrapOnboarding } from "../application/onboarding.service";

interface BootstrapOnboardingArgs {
  input: Parameters<typeof bootstrapOnboarding>[2];
}

export const onboardingGraphQLModule = {
  ...onboardingGraphQLSpec,
  authenticatedMutationResolvers: {
    onboardingBootstrap: async (_parent, args: BootstrapOnboardingArgs, context) =>
      bootstrapOnboarding(context.bindings.DB, context.viewer, args.input),
  },
} satisfies GraphQLModule;
