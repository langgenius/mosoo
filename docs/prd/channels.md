# Channels

Status: not currently available as an end-to-end user feature. The connection
and messaging paths exist, but the Web console has no reachable setup entry and
no provider has a recorded live-account smoke test.

## Why it matters

App owners want a published Agent to answer people in the messaging tools they
already use. External participants should be able to ask for help without
creating a Mosoo account or leaving their current conversation.

## People

- **App owner:** connects a messaging account to a published Agent, checks its
  status, and disconnects it when needed.
- **External participant:** mentions or messages the bot and receives the
  Agent's response in the same external conversation.

## Intended user flow

1. The App owner publishes an Agent and chooses a messaging provider.
2. The owner connects Slack, Lark / Feishu, Telegram, Discord, or personal
   WeChat and confirms which Agent should answer.
3. An external participant sends a direct message or supported mention.
4. Mosoo starts a new Agent conversation for a new external thread, or
   continues the existing conversation for a follow-up.
5. The Agent's response returns to the same external thread. Disconnecting the
   channel stops new messages while preserving existing Mosoo conversations.

## Current availability

- **Settings:** setup screens, connection status, activity, errors, and removal
  exist for all five providers. Users cannot reach them today: there is no
  Channels page, main-navigation item, or App Settings entry, and the Agent
  distribution entry is hidden.
- **Receiving and replying:** repository code and automated tests cover inbound
  text messages, conversation continuity, and replies for all five providers.
  This shows intended behavior, not proof that a real provider account works.
- **Live use:** none of the five providers is currently verified or claimable as
  user-ready. A real-account setup, inbound message, follow-up, and reply check
  is still required for each provider.

External participants remain external identities. They do not gain access to
the App, the Mosoo console, or private Web conversations.
