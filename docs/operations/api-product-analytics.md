# API product analytics

Measure application integration usage separately from console visits. PostHog
receives `api_request_completed` from Public API v1/v2 and token-authenticated
GraphQL. The event uses the owning account as its person identity; count key or
Project properties, not unique persons, for integration metrics.

## Metrics

Use UTC calendar weeks starting Monday. Filter to `environment = production`,
`credential_type = project_key` and `is_internal = false`. Internal means an
account with a `@dify.ai` email, matching the console's existing classification.
Show the current incomplete week separately from completed weeks.
Stage must have no PostHog key, as required by the
[release runbook](../production-deploy-verification.md): its environment label
is also `production`, so that property alone cannot exclude staging traffic.

| Metric                     | Calculation                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weekly Active Tokens (WAT) | Distinct `api_key_id` values with at least one `request_succeeded = true` event that week. Token means a Project API credential, not model tokens.                                                            |
| API Requests per Project   | Event count grouped by `project_id` and week, including failed requests after authentication. Break down by `request_succeeded`, `status_code`, `api_surface` and `route`.                                    |
| Weekly Active Projects     | Distinct `project_id` values with at least one successful request that week.                                                                                                                                  |
| Project API retention      | Cohort by the Project's first observed successful request week; measure the share with another successful request in each later completed week. Key rotation does not create a new Project.                   |
| Web retention              | Returning identified accounts with `page_viewed` on the console host (`cloud.mosoo.ai`, or legacy `try.mosoo.ai`), excluding login/onboarding pages and internal users. Keep marketing/blog traffic separate. |

For PostHog Trends, use the request event and these filters for request counts.
Use HogQL distinct-property aggregation for key/Project counts; the default
unique-user aggregation counts accounts and answers a different question.

This weekly per-Project query supplies request volume and active key counts:

```sql
SELECT
    toStartOfWeek(timestamp, 1) AS week,
    properties.project_id AS project_id,
    count() AS api_requests,
    countIf(properties.request_succeeded = true) AS successful_requests,
    uniqExactIf(properties.api_key_id, properties.request_succeeded = true) AS active_tokens
FROM events
WHERE event = 'api_request_completed'
    AND timestamp >= toStartOfWeek(now(), 1) - INTERVAL 12 WEEK
    AND timestamp < toStartOfWeek(now(), 1)
    AND properties.environment = 'production'
    AND properties.credential_type = 'project_key'
    AND properties.is_internal = false
GROUP BY week, project_id
ORDER BY week DESC, api_requests DESC
LIMIT 500
```

The table displays at most 500 Project-weeks. Narrow the date range or paginate
for complete exports; do not calculate an overall total from truncated rows.

## Coverage and interpretation

- Each authenticated HTTP request counts once. Retries and idempotency replays
  remain requests; `idempotency_replayed` distinguishes Public API replays.
  An SSE connection counts once when its response starts, not once per message.
- Public API success means a 2xx response. GraphQL success additionally requires
  no GraphQL errors. Neither means the resulting Agent Run eventually succeeds.
  Read/poll traffic can dominate request volume; compare routes when interpreting
  growth. Use `task_succeeded` separately for completed work, never as API-only
  activity: `session_type = ui` also includes Public API Sessions.
- `mcli_` account-login requests are recorded as `credential_type = cli_login`
  with no inferred Project. Analyze their distinct `api_key_id` separately.
  In GraphQL, cookie-authenticated requests are not token activity, even if a
  bearer header exists.
- Invalid/revoked credentials, unauthenticated traffic, preflight, and public
  OpenAPI documents do not count. Requests rejected before a GraphQL viewer is
  authenticated have no attributable key event. Driver/LLM proxy and background
  maintenance traffic are outside this metric.
- API traffic includes SDKs, scripts and other clients using a key. No client
  identity is guessed from a user agent. Events include only key record IDs,
  trusted Project scope, route templates and outcome metadata; no token values,
  hashes, GraphQL documents/variables, request bodies or URL query strings.
- Capture is unsampled and best effort, with bounded background delivery and no
  durable analytics queue. Missing events are possible; this is not a billing
  ledger. Event volume scales with authenticated requests, including polling.
- History starts with instrumentation deployment. The first observed cohort is
  not necessarily the Project's true first use; exclude that initial cohort when
  evaluating newly activated Projects. Missing history is not zero activity.

## Release verification

Follow the [release runbook](../production-deploy-verification.md). With the
existing production PostHog key configured, verify a controlled Project-key
request arrives with the expected Project/key IDs, route and outcome, then
verify Web visits remain `page_viewed`. Confirm failed requests do not enter WAT.
Run the saved queries only after the new event/properties appear in PostHog;
empty charts before deployment do not establish a usage baseline.
