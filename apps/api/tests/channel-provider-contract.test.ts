import { describe, expect, test } from "bun:test";

import {
  AGENT_CHANNEL_BINDING_PROVIDERS,
  AGENT_CHANNEL_WEBHOOK_PROVIDERS,
  AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS,
  buildAgentChannelWebhookPath,
  buildAgentChannelWebhookUrl,
} from "@mosoo/contracts/channel";
import { isEnumType } from "graphql";

import { createGraphQLSchema } from "../src/adapters/graphql/create-graphql-schema";

const apiSchema = createGraphQLSchema();

function collectGraphqlEnumValues(enumName: string): string[] {
  const enumType = apiSchema.getType(enumName);

  if (!isEnumType(enumType)) {
    throw new Error(`Expected GraphQL enum ${enumName}.`);
  }

  return enumType.getValues().map((value) => value.name);
}

describe("channel provider contract", () => {
  test("keeps GraphQL provider enum aligned with the shared provider registry", () => {
    expect(collectGraphqlEnumValues("ChannelProvider").toSorted()).toEqual(
      [...AGENT_CHANNEL_BINDING_PROVIDERS].toSorted(),
    );
  });

  test("keeps channel webhook route patterns aligned with the shared webhook registry", () => {
    expect(Object.keys(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS).toSorted()).toEqual(
      [...AGENT_CHANNEL_WEBHOOK_PROVIDERS].toSorted(),
    );
    expect(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS.slack).not.toContain(":bindingId");
    for (const provider of AGENT_CHANNEL_WEBHOOK_PROVIDERS) {
      expect(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS[provider]).toContain(`/channels/${provider}/`);
      if (provider !== "slack") {
        expect(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS[provider]).toContain(":bindingId");
      }
    }
  });

  test("builds public webhook paths and urls from the shared channel contract", () => {
    const slackPath = buildAgentChannelWebhookPath({ provider: "slack" });
    expect(slackPath).toStartWith("/api/");
    expect(slackPath).toContain("/channels/slack/events");

    const discordPath = buildAgentChannelWebhookPath({
      bindingId: "binding/1",
      provider: "discord",
    });
    expect(discordPath).toContain("/channels/discord/events/");
    expect(discordPath).toContain(encodeURIComponent("binding/1"));

    const telegramUrl = new URL(
      buildAgentChannelWebhookUrl({
        bindingId: "binding-1",
        origin: "https://api.example.com/",
        provider: "telegram",
      }),
    );
    expect(telegramUrl.origin).toBe("https://api.example.com");
    expect(telegramUrl.pathname).toBe(
      buildAgentChannelWebhookPath({ bindingId: "binding-1", provider: "telegram" }),
    );
  });
});
