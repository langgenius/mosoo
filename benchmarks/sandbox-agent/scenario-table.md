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
| `benchmark_mmlu_cs`    | no      | Public API     | MMLU-style professional knowledge MCQ                       | Correct option token appears                               | create accepted -> token complete |
| `benchmark_gpqa_science` | no    | Public API     | GPQA-style science reasoning MCQ                            | Correct option token appears                               | create accepted -> token complete |
| `benchmark_gsm8k_reasoning` | no | Public API     | GSM8K-style arithmetic reasoning                            | Correct option token appears                               | create accepted -> token complete |
| `benchmark_humaneval_code` | no | Public API     | HumanEval-style code correctness selection                  | Correct implementation token appears                       | create accepted -> token complete |
| `benchmark_mbpp_python` | no     | Public API     | MBPP-style Python problem selection                         | Correct implementation token appears                       | create accepted -> token complete |
| `benchmark_swe_patch`  | no      | Public API     | SWE-bench-style issue/patch reasoning                       | Correct patch token appears                                | create accepted -> token complete |
| `benchmark_bfcl_tool_call` | no  | Public API     | BFCL-style function-call planning                           | Correct tool-call token appears                            | create accepted -> token complete |
| `benchmark_ifeval_constraints` | no | Public API  | IFEval-style verifiable instruction selection               | Correct compliant-candidate token appears                  | create accepted -> token complete |
| `benchmark_json_extraction` | no | Public API     | Structured extraction / value-accuracy style output         | Expected JSON token appears                                | create accepted -> token complete |

## Suites

| Suite | Scenarios | Purpose |
| ----- | --------- | ------- |
| `default` | The six default runtime/API scenarios | Fast smoke and latency baseline. |
| `benchmark_lite` | The nine `benchmark_*` scenarios | Public benchmark-inspired scoring dimensions without Skills/MCP/Spaces. |
| `full` | `default` plus `benchmark_lite` | Broader regression and latency run. |

## Intentional V1 Boundaries

- The benchmark Agent should stay simple: default Agent profile, no Skills, no MCP servers, no Spaces, and one known-working runtime credential.
- Provider API keys are configured in the local Mosoo service before the run. The benchmark harness should not need the model provider key unless a later setup mode creates or configures Agents automatically.
- Cloudflare authentication is used for operator visibility and diagnostics. The core benchmark path is still local Mosoo control plane -> Cloudflare online execution plane.
- The `benchmark_lite` suite is benchmark-inspired, not a reproduction of public leaderboards. It uses original, compact prompts with deterministic token scoring so success rate and latency remain attributable to this sandbox path.
