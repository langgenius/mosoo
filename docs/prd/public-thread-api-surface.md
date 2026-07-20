# Public Thread API

Status: Available for App-owner integrations with a limited identity model. The
exact HTTP contract is the
[OpenAPI document](https://try.mosoo.ai/api/v1/openapi.json).

## Why it exists

Builders need to use a mosoo Agent from their own product without learning how
it runs. The Public Thread API makes each conversation or job a durable Thread
that an integration can start, follow, continue, and recover.

## Who uses it

- An App owner connects an exposed Agent to a server-side integration.
- An App user may trigger that integration, but does not authenticate directly
  with mosoo today.

## User flow

1. The owner exposes an Agent, creates an Access Token, and stores it on a
   trusted backend.
2. The backend creates a Thread, empty or with an initial message and files.
3. It reads or streams public events, checks the latest Run, and can send a
   follow-up, answer a permission request, or interrupt work.
4. It can list, retrieve, archive, restore, or delete Threads, and upload,
   attach, download, or remove Thread files.

## What is available now

The core Thread lifecycle, public event feed, and file workflow are usable. The
Agent's API Access panel shows its identifier, token creation, and API reference.

## User-visible boundaries

- Access Tokens belong to the App owner. The Agent must be exposed, owned by
  that same owner, and remain inside the same App.
- mosoo does not yet represent the integration's end users. Every public Thread
  is attributed to the App owner's mosoo account, so the integration must
  enforce end-user access and maintain its own user-to-Thread mapping.
- Tokens are backend secrets and are not suitable for browser or mobile clients
  that cannot keep them private.
- Public events show stable progress and outcomes, not private diagnostics or
  raw runtime data.
- Thread files include explicit attachments and recorded Agent artifacts, not a
  complete runtime workspace. Thread history also does not guarantee that every
  later Run receives prior private runtime state or every earlier file.
