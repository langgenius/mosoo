import type { AgentChannelBindingFieldsFragment } from "@/gql/graphql";

export function indexChannelBindingsByProvider(
  bindings: readonly AgentChannelBindingFieldsFragment[],
): ReadonlyMap<string, AgentChannelBindingFieldsFragment> {
  const byProvider = new Map<string, AgentChannelBindingFieldsFragment>();

  for (const binding of bindings) {
    if (!byProvider.has(binding.provider)) {
      byProvider.set(binding.provider, binding);
    }
  }

  return byProvider;
}
