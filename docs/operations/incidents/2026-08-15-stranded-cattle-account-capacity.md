# 2026-08-15 — Stranded Cattle Sandboxes Exhausted Account Capacity

- Status: Resolved
- Severity: SEV-3
- Window: 2026-08-13 10:57–2026-08-15 10:58 UTC
- Affected surface: OpenCode (ACP) runtime provisioning for one account
- Public status update: https://mosoo.ai/status
- Tracking PRs:
  [#538](https://github.com/langgenius/mosoo/pull/538) and
  [#539](https://github.com/langgenius/mosoo/pull/539)

## Summary And Impact

New Runs for one account could not acquire runtime capacity even though earlier
Cattle conversations were no longer active. Users saw
`runtime.provision_failed` with "Runtime subject is busy with lifecycle
maintenance" instead of a started Run.

The observed failure cluster contained 54 user-facing Runs across one account
and four Agents. Other accounts were not confirmed affected. Successful Runs
were still possible when capacity was available, so the incident appeared as
intermittent provisioning failure rather than a platform-wide outage.

## Timeline

- 2026-08-13 10:57 — The first matching user-facing provisioning failure was
  recorded.
- 2026-08-15 09:49 — The last matching pre-fix failure was recorded.
- 10:17 — The lifecycle convergence and historical repair hotfix was committed.
- 10:22 — [#538](https://github.com/langgenius/mosoo/pull/538) merged.
- 10:28 — The API hotfix reached production.
- 10:31 — The deployment workflow reported failure after healthy Workers
  returned Cloudflare's zone-level HTTP 301 redirect instead of the expected
  Worker fallback HTTP 308.
- 10:36 — [#539](https://github.com/langgenius/mosoo/pull/539) aligned final
  verification with the production redirect and merged.
- 10:43 — The repeated deployment and final endpoint verification completed.
- 10:54 — The first post-repair user-facing ACP Run completed.
- 10:58 — A second consecutive user-facing Run completed; recovery was
  confirmed. No later matching provisioning failure was recorded through
  2026-08-17.

## Root Cause

The idle conversation close path treated remote Sandbox session deletion as a
prerequisite for local lifecycle convergence. When Cloudflare reported that a
remote session was already absent, the delete call failed and local finalization
did not arm the Cattle subject's inactive deadline.

Those active subjects had no conversation or Run lease but continued to count
against the account's concurrent sandbox limit. Admission then rejected new
subjects with the same generic lifecycle-busy error used for real maintenance
contention. No maintenance repair existed for already-stranded subjects.

## Detection And Response

Run telemetry exposed repeated `runtime.provision_failed` results, while
lifecycle logs and database state connected them to remote `session not found`
cleanup errors and active Cattle subjects without inactive deadlines. The
hotfix made local close finalization unconditional and added a maintenance
repair for historical stranded records.

The first release workflow failure was a verification false alarm, not a second
user outage: the API and Web Workers had deployed, but the final probe expected
HTTP 308 while Cloudflare redirected plaintext traffic with HTTP 301 before
either Worker ran.

## Corrective Actions

- [x] Runtime team — converge the local conversation lifecycle even when remote
      Sandbox deletion fails — 2026-08-15
- [x] Runtime team — repair active Cattle subjects that have no conversation,
      Run lease, or inactive deadline — 2026-08-15
- [x] Runtime team — cover remote `session not found` and stranded-subject
      repair with regression tests — 2026-08-15
- [x] Release team — verify Cloudflare's zone-level HTTP 301 while preserving
      exact HTTPS redirect-target checks — 2026-08-15

## Lessons

Remote cleanup is best-effort; local capacity accounting must still converge in
a `finally` path. Every lifecycle fix also needs a repair path for records that
were stranded before the fix. Release verification must model the edge layer
that answers first, otherwise a healthy deployment can be mistaken for a
failed recovery.
