import { describe, expect, test } from "bun:test";

import type { AgentChannelBindingFieldsFragment } from "../src/gql/graphql";
import { indexChannelBindingsByProvider } from "../src/routes/agent/components/channel-binding-index";

function channelBinding(
  id: string,
  provider: AgentChannelBindingFieldsFragment["provider"],
): AgentChannelBindingFieldsFragment {
  return {
    id,
    provider,
  } as AgentChannelBindingFieldsFragment;
}

describe("channel binding provider index", () => {
  test("indexes bindings by provider and preserves first-match selection", () => {
    const slack = channelBinding("binding-slack", "slack");
    const firstTelegram = channelBinding("binding-telegram-1", "telegram");
    const secondTelegram = channelBinding("binding-telegram-2", "telegram");

    const byProvider = indexChannelBindingsByProvider([slack, firstTelegram, secondTelegram]);

    expect(byProvider.has("slack")).toBe(true);
    expect(byProvider.get("slack")).toBe(slack);
    expect(byProvider.get("telegram")).toBe(firstTelegram);
  });
});
