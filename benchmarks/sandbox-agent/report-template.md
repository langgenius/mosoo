# Sandbox Agent Benchmark Report

## Run Summary

| Field                    | Value                                      |
| ------------------------ | ------------------------------------------ |
| Run ID                   |                                            |
| Date                     |                                            |
| Operator                 |                                            |
| Local Mosoo base URL     |                                            |
| Agent ID                 |                                            |
| Agent profile            | Default/simple Agent, no Skills/MCP/Spaces |
| Runtime                  |                                            |
| Cloudflare account check |                                            |
| Suite(s)                 |                                            |
| Total cases              |                                            |
| Success rate             |                                            |
| p50 first assistant text |                                            |
| p95 first assistant text |                                            |
| p50 token complete       |                                            |
| p95 token complete       |                                            |

## Environment

- Local Mosoo API health:
- Local Mosoo Web health:
- Cloudflare Worker/Sandbox status:
- Wrangler identity:
- Mosoo PAT scope/source:
- Provider credential source:

## Results

| Scenario               | Attempts | Success | p50 first text ms | p95 first text ms | p50 token ms | p95 token ms | Notes |
| ---------------------- | -------: | ------: | ----------------: | ----------------: | -----------: | -----------: | ----- |
| `smoke_first_turn`     |          |         |                   |                   |              |              |       |
| `same_thread_followup` |          |         |                   |                   |              |              |       |
| `structured_output`    |          |         |                   |                   |              |              |       |
| `long_context`         |          |         |                   |                   |              |              |       |
| `event_stream`         |          |         |                   |                   |              |              |       |
| `thread_lifecycle`     |          |         |                   |                   |              |              |       |
| `benchmark_mmlu_cs`    |          |         |                   |                   |              |              |       |
| `benchmark_gpqa_science` |        |         |                   |                   |              |              |       |
| `benchmark_gsm8k_reasoning` |    |         |                   |                   |              |              |       |
| `benchmark_humaneval_code` |      |         |                   |                   |              |              |       |
| `benchmark_mbpp_python` |         |         |                   |                   |              |              |       |
| `benchmark_swe_patch`  |          |         |                   |                   |              |              |       |
| `benchmark_bfcl_tool_call` |      |         |                   |                   |              |              |       |
| `benchmark_ifeval_constraints` | |         |                   |                   |              |              |       |
| `benchmark_json_extraction` |    |         |                   |                   |              |              |       |

## Failures

| Scenario | Thread ID | Phase | Error | Likely Layer                                                                                |
| -------- | --------- | ----- | ----- | ------------------------------------------------------------------------------------------- |
|          |           |       |       | local control plane / Cloudflare scheduling / sandbox runtime / model provider / public API |

## Interpretation

- Cold-start signal:
- Warm continuation signal:
- Streaming signal:
- Lifecycle/API control signal:
- Benchmark-lite score:
- Main bottleneck hypothesis:

## Follow-ups

-
