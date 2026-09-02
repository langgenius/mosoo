# Product analytics (PostHog Cloud)

mosoo sends explicit, low-volume product events to one PostHog Cloud project. Browser events cover intent and navigation; API events cover authoritative business outcomes. Analytics failures never fail the business operation.

## Identity and privacy

- Before login, the web app uses a persistent random `mosoo_anon_*` ID.
- After login, `$identify` joins that anonymous history to the stable mosoo account ID.
- `$identify` sets `$internal_or_test_user` for `@dify.ai` accounts so PostHog can exclude internal traffic without receiving the email address.
- Logout creates a fresh anonymous ID so two accounts on one browser are not mixed.
- Email addresses, prompts, credentials, task content, and model responses are not sent.
- PostHog autocapture and session replay are not enabled by this integration.

## Events

Browser intent events:

- `page_viewed`
- `login_started`
- `onboarding_started`

Authoritative API events:

- `signup_completed`
- `onboarding_completed` after the account's organization and default Project are bootstrapped
- `project_created` when a user manually creates an additional Project
- `agent_created`
- `integration_connected` after a model-provider credential probe succeeds
- `task_succeeded` after a runtime run first transitions to completed; `session_type` identifies `ui` or `preview` traffic

Common properties include `environment`, `deployment_mode`, and the relevant `organization_id`, `project_id`, `agent_id`, integration type, or runtime identifiers. Person identity is the stable account ID.

The App-to-Project release starts the `project_created` event and `project_id` property. Insights spanning that release must include legacy `app_created` events and coalesce the legacy `app_id` property with `project_id`; historical PostHog events are not rewritten.

## Configuration

Create one PostHog Cloud project and copy its **Project API key** (the public `phc_...` ingestion key) and regional ingestion host.

Configure the GitHub `try` environment secret `POSTHOG_PROJECT_KEY`. The deploy workflow injects it as `VITE_POSTHOG_PROJECT_KEY` while building the web app.

Set the same key on the API Worker:

```bash
cd apps/api
../../node_modules/.bin/vp exec wrangler secret put POSTHOG_PROJECT_KEY --env prod
```

The repository defaults both sides to the US ingestion host, `https://us.i.posthog.com`. If the project is in PostHog EU Cloud, change both `POSTHOG_API_HOST` in `apps/api/wrangler.toml` and `VITE_POSTHOG_API_HOST` in the deploy workflow to `https://eu.i.posthog.com`.

For local analytics, put matching `VITE_POSTHOG_PROJECT_KEY` and `POSTHOG_PROJECT_KEY` values in the normal local environment. Without the project key, analytics is intentionally disabled. This integration does not require a PostHog personal API key.

## Suggested insights

Activation funnel, unique users ordered:

```text
signup_completed -> agent_created -> task_succeeded
```

`onboarding_completed` is an automatic bootstrap milestone, and every new account receives a default Project, so neither it nor `project_created` is a required activation step. `integration_connected` is also diagnostic: it can happen before or after Agent creation and is not required by every successful runtime path. Event totals for `task_succeeded` count completed runs; use a unique-user funnel when measuring activation.

Also create:

- a path insight starting from `page_viewed`;
- an onboarding funnel `onboarding_started -> onboarding_completed`;
- a manual Project-creation insight from `project_created` where `source = manual`;
- a breakdown of `integration_connected` by `vendor_id`;
- a breakdown of all funnels by `environment` and `deployment_mode`.

Payments and subscriptions are not currently mosoo product surfaces, so no synthetic payment events are emitted.
