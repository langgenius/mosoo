# ACP provider content rejection — September 22, 2026

Status: platform classification fix under review; no production deployment.

## Observation and evidence boundary

Run `01M32VK9QVKHTPBVTR4YNXQBVS`, using `step-3.7-flash` through
`acp-fallback`, failed at 04:49 CST with the ACP error
`Internal error: The content you provided or machine outputted is blocked.`
Read-only production inspection found one failed terminal event, an idle Session,
and a Driver WebSocket that subsequently closed normally with code 1000. This was not an
observed stuck Driver or heartbeat timeout.

Ten tool calls had completed before the refusal: Skill loading, seven reads of
the attached Skill, one local todo update, and a public GitHub clone. The error
arrived after the clone result. Earlier model output and tools demonstrate that
the initial prompt was accepted, but do **not** identify the input/output stage
of the later blocked model exchange. The provider message itself names both
possibilities. No recorded operation sent a message or wrote to an external
service. Existing tool effects and failure history must not be rewritten.

The production Worker was `e4542230-7b49-45aa-90b3-cf58dc83abb8` at 100% traffic.
The repair retains Mosoo `a8a4d03176` and protocol-v2 Driver `d1f6ea8` as its
baseline; the Driver PR targets `release/protocol-v2`.

## Platform repair

- Classify the observed structured ACP `RequestError` as `acp.content_blocked`,
  with `category=content_policy`, `stage=unknown`, and `retryable=false`.
  Match the exact observed message, optionally prefixed by ACP's internal-error
  label. Unrelated errors and arbitrary assistant/tool/user text are not matched.
- Explain the content block in the console, including unknown input/output
  stage, no automatic retry, and possible already-completed tool actions.
- Treat the standard ACP `stopReason=refusal` as `acp.refused` and failed, instead
  of success. [ACP defines this as refusing to continue](https://agentclientprotocol.com/protocol/v1/prompt-turn#stop-reasons);
  it does not establish a specific content-policy cause. Close unfinished tool
  records as failed, retain completed records, and do not replay their effects.
  An ordinary assistant safety explanation followed by `end_turn` remains a
  successful response.

There is no automatic retry, prompt rewriting, provider switching, content-filter
bypass, historical status update, migration, or Driver protocol upgrade in this
repair. Local changes require the normal coordinated API/container and console
release before they affect production.

## Acceptance scope

Focused regressions cover conservative error matching, refusal terminal semantics,
unchanged completed tools, subsequent explicit input at the backend boundary, no duplicate prompt,
ordinary safety explanations, canonical D1 failure persistence, late generic
error deduplication, idle Session state, and localized console copy.

The original frozen Skill archive has SHA-256
`d093daf7b382c5c34229ce96d3314f7f5c9ce29f59e4adf846a6a52fdd77917e`.
The isolated native-runtime canary uses the original prompt/input/Skill for the
negative case and a harmless control input for the positive case. Upstream
responses are controlled, including the observed provider rejection; OpenCode,
the built Driver, and the filesystem tool actually execute. A local append-only
marker checks that a tool effect occurs once before rejection. The negative case
emits one failed Run and exits the Driver with code 1 through the existing failed
command path; the independent positive case completes and stops with code 0.
Both cases inspect native descendant processes through Linux `/proc` after exit.
External networking is
disabled, a stricter boundary than the original limited-network configuration.

The completed local checks used OpenCode 1.18.4 and Driver protocol 2. Each
canary made two tool-enabled model requests and wrote its marker once; no native
descendant process survived shutdown. All 11 materialized Skill files matched
the frozen archive byte for byte. Linux `just check` passed, including 1,015 API,
1,273 Driver, and 251 console tests; 40 Driver tests requiring other environments
or credentials were skipped. The console notice was inspected at desktop and
390-pixel widths using the actual component and built application CSS.

This does not establish a live StepFun reproduction or production recovery.
There is no available authorized StepFun test credential, and shared stage uses
a newer Driver protocol. Neither shared stage nor production is redeployed for
this local acceptance. The remaining live check is one isolated, same-provider
negative/control pair using authorized test access and the original network
policy, without forcing a rejection or replaying external side effects.
