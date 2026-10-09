import type { GraphQLModule } from "../../../adapters/graphql/graphql-module";
import { bootstrapOnboarding } from "../application/onboarding.service";

interface BootstrapOnboardingArgs {
  input: Parameters<typeof bootstrapOnboarding>[2];
}

export const onboardingGraphQLModule = {
  authenticatedMutationResolvers: {
    onboardingBootstrap: async (_parent, args: BootstrapOnboardingArgs, context) =>
      bootstrapOnboarding(context.bindings, context.viewer, args.input),
  },
} satisfies GraphQLModule;
