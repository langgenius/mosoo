# Product analytics (PostHog Cloud)

Mosoo sends explicit, low-volume product events to one PostHog Cloud project. Browser events cover intent and navigation; API events cover authoritative business outcomes. Analytics failures never fail the business operation.

## Identity and privacy

- Before login, the web app uses a persistent random `mosoo_anon_*` ID.
- After login, `$identify` joins that anonymous history to the stable Mosoo account ID.
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
- `onboarding_completed`
- `app_created`
- `agent_created`
- `integration_connected` after a model-provider credential probe succeeds
- `task_succeeded` after a runtime run first transitions to completed

Common properties include `environment`, `deployment_mode`, and the relevant `organization_id`, `app_id`, `agent_id`, integration type, or runtime identifiers. Person identity is the stable account ID.

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
signup_completed -> onboarding_completed -> app_created -> agent_created -> integration_connected -> task_succeeded
```

Also create:

- a path insight starting from `page_viewed`;
- an onboarding funnel `onboarding_started -> onboarding_completed`;
- a breakdown of `integration_connected` by `vendor_id`;
- a breakdown of all funnels by `environment` and `deployment_mode`.

Payments and subscriptions are not currently Mosoo product surfaces, so no synthetic payment events are emitted.
