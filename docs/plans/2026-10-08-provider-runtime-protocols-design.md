# Provider, model, and runtime protocol compatibility

The owner approved extending Pi model access by the provider's supported protocol
and considering Provider × Model × Harness combinations as a whole. The current
implementation uses three inconsistent decisions: vendor membership for model
availability, vendor/npm/runtime inference at startup, and Chat Completions-only
Pi configuration. Custom credentials do not declare their API protocol.

## Decision

Keep the existing four managed model protocols and the existing Worker proxy.
Declare each runtime's supported protocols in the shared runtime catalog. Resolve
one protocol from the selected preset provider/model or custom credential, then
use that result for availability, admission, Session freezing, proxy grants, and
runtime configuration. Preserve provider/model allowlists in addition to protocol
compatibility. Pi and OpenCode support all four; OpenAI Runtime requires Responses;
Claude Agent SDK retains its supported Anthropic models and Messages protocol.

A preset's protocol remains attached to its provider/model identity, because Zen
can serve multiple protocol families and the same model name can have different
endpoints across providers. Existing preset protocols and endpoints are unchanged,
including Gemini's Chat Completions-compatible endpoint. Custom credentials add
one nullable `modelProtocol`, covering every model explicitly declared on that
endpoint. This makes the endpoint's wire contract explicit without inventing
automatic protocol detection, endpoint conversion, or a provider marketplace.

New custom credentials default to Chat Completions. Existing NULL rows retain
the historical per-runtime mapping until explicitly configured. Updating unrelated
fields does not fill them. Explicit protocol values cannot be cleared to NULL.
New Sessions freeze the resolved protocol; cold and warm continuation compare it
with the current selected credential. Old custom Session snapshots infer the
historical runtime mapping before comparison. Duplicate custom model IDs retain
the existing deterministic credential selection; protocol compatibility never
causes a silent credential switch.

Pi receives the corresponding native API name in its existing model configuration.
OpenCode custom providers select the matching existing SDK adapter. Anthropic
version segments are normalized across clients. Custom Google uses its native
authentication header. The Worker still binds each grant to exactly one model,
protocol, Project credential, and Driver generation, and keeps real secrets outside
the Sandbox. A changed explicit credential protocol invalidates incompatible grants.

Console, GraphQL, generated CLI, and three-language documentation carry the same
protocol field and compatibility matrix. Explicit provider tests call the selected
protocol and inspect its response envelope; readiness may verify key connectivity
without claiming a full protocol/tool test.

## Alternatives considered

Only changing Pi's API string would leave false-positive model availability and
wrong credential probes. Converting every model to Responses would require a new
gateway and would misrepresent providers that do not implement Responses. Native
protocol selection reuses the adapters and authorization already present.

## Verification and rollout

Test the full catalog/runtime protocol matrix, duplicate model identity handling,
credential round-trips, create/update legacy behavior, and cold/warm Session protocol
drift. Run real Pi CLI through the Worker route and local deterministic upstreams
for all four protocols, including a real tool and follow-up request. Verify paths,
authentication replacement, model-bound rejection, and streaming. These fixtures do
not substitute for paid-provider or hosted staging acceptance.

The sole database change adds nullable `vendor_credential.model_protocol`; no
existing migration or row is rewritten. Apply and verify the additive migration
before API deployment, then deploy the generated Web/CLI surfaces. Reverting API
code can leave the nullable column in place, but Sessions and credentials using
new protocols must not be routed through the old Chat-only Pi implementation.
Use staged validation and preserve the prior deployment revision before production.
OAuth, cloud identity credentials, media inputs, and changing runtime mid-Session
remain outside this change.
