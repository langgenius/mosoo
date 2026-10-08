# Pi runtime

Pi uses its native RPC transport (`pi-rpc`) through the same Driver protocol 6
and Session lifecycle as the existing runtimes. The public runtime ID is `pi`.
It runs in the `SandboxPi` image and remains optional: custom providers still
default to OpenCode unless the caller explicitly chooses Pi.

## Configuration

Add a catalog provider key, or a custom provider with an HTTPS endpoint, API key,
exact model IDs, and **Model protocol**. Select Pi and that model in the Agent
editor, or use `harness: "pi"` with the selected provider in the public API
execution configuration. Custom providers retain the API ID `openai-compatible`.
The selected endpoint must support streaming and tool calls. Pi currently
accepts text input; files remain available through the Session workspace.

| Provider/model protocol | Pi API | Other supported runtimes |
| --- | --- | --- |
| `openai-chat-completions` | `openai-completions` | OpenCode |
| `openai-responses` | `openai-responses` | OpenAI Runtime, OpenCode |
| `anthropic-messages` | `anthropic-messages` | OpenCode; Claude Agent SDK for its supported Anthropic models |
| `google-gemini` | `google-generative-ai` | OpenCode |

Preset models use their catalog protocol. A provider such as OpenCode Zen can
serve models using several protocols; model names alone do not select one.
The named Gemini provider keeps its existing Chat Completions endpoint. A custom
native Google endpoint can use `google-gemini` with its versioned API base.
Anthropic endpoints accept either a root base or a base ending in `/v1`; the
proxy normalizes the version segment for Pi and OpenCode.

New custom credentials default to Chat Completions. Existing credentials without
a protocol preserve their historical runtime-specific selection until explicitly
configured. Unspecified is not a protocol test result. Explicit tests call the
chosen model protocol instead of inferring support from `GET /models`.
This managed API-key path does not add standalone Pi OAuth login, Bedrock signing,
or Vertex ambient credentials.

Pi follows the product's full-access execution contract. Individual built-in
tool restrictions and interactive approval policies are rejected. Remote MCP
bindings use the existing Worker-side MCP proxy. Skills and Session artifacts
use the existing Driver contracts.

The Driver receives only the selected model, the Worker LLM proxy URL, and a
short-lived, model- and Driver-generation-bound grant. The raw provider key
stays in the control plane. `MOSOO_PI_CONFIG_CONTENT` renders the selected model
under Pi's `mosoo` provider; `MOSOO_PI_PROXY_GRANT` supplies the grant by an
environment reference. Both variables are reserved and removed from user
Environment variables before setup.

## Continuation and rollout

Native resume references use `pi_session_path` and point to a session JSONL file
relative to Pi's home under the checkpointed Session workspace. Continuation
requires that file; missing or mismatched native state fails instead of starting
an empty conversation. Workspace checkpointing, cancellation, and terminal
outcomes use the existing Session machinery.

New Sessions freeze the selected model protocol. A credential change to a
different protocol fails continuation before runtime provisioning. Restore the
original protocol or create a new Session for the new protocol. Older custom
Sessions infer their historical protocol from their runtime; they do not silently
switch from Chat Completions to Responses.

Deploy the matched Driver revision, API Worker, `SandboxPi` image, and append-only
`v4-pi-runtime` Durable Object migration together. Keep historical bindings and
images available for existing Sessions. Follow the
[runtime image rollout procedure](production-deploy-verification.md#runtime-image-namespace-compatibility).

Local admission, proxy, catalog, image, and native continuation contracts can be
verified without provider credentials. The Driver's Pi fixtures also exercise
the real CLI against a loopback model endpoint. Hosted Cloudflare acceptance
still requires a configured test Project and model provider; fixture results do
not establish hosted availability.
