# Sandbox Agent Benchmark Scenario Table

| Scenario               | Default | Surface        | Function Covered                                            | Success Signal                                              | Primary Latency                   |
| ---------------------- | ------- | -------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| `smoke_first_turn`     | yes     | Public API     | Create Thread, first run dispatch, sandbox boot/warm path   | Expected token appears and run does not fail                | create accepted -> token complete |
| `same_thread_followup` | yes     | Public API     | Send Events into existing Thread, conversation continuation | Follow-up token appears after setup turn                    | send accepted -> token complete   |
| `structured_output`    | yes     | Public API     | Prompt adherence and output shaping                         | JSON response contains expected token                       | create accepted -> token complete |
| `long_context`         | yes     | Public API     | Larger prompt handling and runtime input transfer           | Expected token appears                                      | create accepted -> token complete |
| `event_stream`         | yes     | Public API SSE | `/events/stream` event delivery                             | Stream emits expected token                                 | create accepted -> stream token   |
| `thread_lifecycle`     | yes     | Public API     | retrieve/list/archive/unarchive/delete                      | Lifecycle calls return OK around completed run              | lifecycle operation total         |
| `interrupt_run`        | no      | Public API     | `user_interrupt` event path                                 | Interrupt event is accepted and terminal status is recorded | interrupt accepted -> terminal    |

## Intentional V1 Boundaries

- The benchmark Agent should stay simple: default Agent profile, no Skills, no MCP servers, no Spaces, and one known-working runtime credential.
- Provider API keys are configured in the local Mosoo service before the run. The benchmark harness should not need the model provider key unless a later setup mode creates or configures Agents automatically.
- Cloudflare authentication is used for operator visibility and diagnostics. The core benchmark path is still local Mosoo control plane -> Cloudflare online execution plane.
