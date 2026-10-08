# Pi runtime

Pi uses its native RPC transport (`pi-rpc`) through the same Driver protocol 6
and Session lifecycle as the existing runtimes. The public runtime ID is `pi`.
It runs in the `SandboxPi` image and remains optional: custom providers still
default to OpenCode unless the caller explicitly chooses Pi.

## Configuration

Add a custom OpenAI-compatible provider to the Project with an HTTPS endpoint,
API key, and the exact model ID supported by that endpoint. Select Pi and that
model in the Agent editor, or use `harness: "pi"` with provider
`openai-compatible` in the public API execution configuration. The endpoint must
support Chat Completions streaming and tool calls. Pi currently accepts text
input; files remain available through the Session workspace.

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

Deploy the matched Driver revision, API Worker, `SandboxPi` image, and append-only
`v4-pi-runtime` Durable Object migration together. Keep historical bindings and
images available for existing Sessions. Follow the
[runtime image rollout procedure](production-deploy-verification.md#runtime-image-namespace-compatibility).

Local admission, proxy, catalog, image, and native continuation contracts can be
verified without provider credentials. The Driver's Pi fixtures also exercise
the real CLI against a loopback model endpoint. Hosted Cloudflare acceptance
still requires a configured test Project and model provider; fixture results do
not establish hosted availability.
