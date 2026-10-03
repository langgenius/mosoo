# Pi v1.0.0 runtime integration draft

Pi uses `pi-acp` 0.0.34 and Pi 1.0.0 on the protocol-6 Driver pinned by
Mosoo. The Driver submodule keeps the canonical upstream URL,
`https://github.com/langgenius/mosoo-agent-driver.git`; the contribution is
[draft PR #130](https://github.com/langgenius/mosoo-agent-driver/pull/130).

## Product contract

Pi is a public runtime backed by a Project's OpenAI-compatible credential and
an explicitly selected model. The raw credential remains in the control plane;
provisioning issues a model-, Driver- and generation-bound Chat Completions
grant. The existing Agent editor and public API use the generated runtime
catalog. Existing default selection for custom credentials remains OpenCode
with the credential's declared model; selecting Pi is explicit.

Pi accepts text input, full access and unrestricted built-in tools. It does not
support MCP servers, supervised tool approval or additional directories. The
catalog declares these capability limits, readiness blocks enabled MCP
bindings, and execution admission rejects unsupported configuration before
launch. Advanced provider options remain empty in product configuration.

Each Session owns its Cloudflare Sandbox and checkpointed runtime home. Both
`pi-acp/.pi/agent/sessions` and `pi-acp/.pi/pi-acp/session-map.json` live below
that home and are included in the existing complete workspace checkpoint.
Native references are persisted with the `acp_session_id` kind; a supplied
reference requires native restoration and cannot fall back to transcript replay.
Never share writable Pi homes between Sessions.

## Infrastructure and rollout

Infrastructure uses `cloudflare/sandbox:0.12.9` pinned by digest, matching the
Worker's `@cloudflare/sandbox` 0.12.9 SDK. `SandboxPi` extends the existing
Cloudflare wrapper. Local, staging and production configurations build its
`RUNTIME=pi` image; `v4-pi-runtime` appends the new Durable Object class without
rewriting prior migrations. The existing runtime-image rollout switch controls
new allocations. The compatibility `all` image also includes Pi.

Database columns remain SQLite TEXT. The TypeScript runtime unions are
extended; `just db-generate pi-runtime` confirms there is no SQL schema change.
Existing migrations and GraphQL outputs are unchanged. Runtime catalog outputs
are regenerated from their authored JSONC source.

Latest Driver main has a separate protocol-3 SDK refactor that conflicts with
Mosoo's protocol-6 host. This draft must reconcile that contribution before
merge; a green package or image test does not establish upstream mergeability.
No cloud deployment or existing customer-state migration is performed here.

## Acceptance and verification

Given an explicitly selected Pi runtime, provisioning must select its
Cloudflare binding, issue a Chat Completions grant, retain the checkpointed
Session home and omit unsupported additional directories. Given MCP bindings
or supervised/tool restrictions, readiness or execution admission must fail
before launch. Given observed native state, the product repositories must
persist the Pi Driver and ACP cursor, committing continuation only through the
existing successful-checkpoint flow.

Given Pi 0.99.2 native state, Pi 1.0.0 must restore conversation history, real
shell tools and refreshed instructions. Given a production image and real
provider through the Mosoo proxy, file write/read, usage and cold continuation
must succeed without persisting the grant. Run the existing
[public API runtime E2E case](../e2e/README.md#pi-v1-runtime) for the complete
non-production control-plane path.

See [Driver details](../apps/driver/docs/pi-acp.md) and
[Driver validation](../apps/driver/docs/validation-protocol6.md). Validation
results in the PR distinguish local Worker, Linux/image and real provider
checks from deployed Cloudflare acceptance.
