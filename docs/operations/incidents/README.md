# Incident Postmortems

Archive every production incident here as
`YYYY-MM-DD-short-description.md`. Use UTC throughout, link the originating
issue or PR, and write for an affected user rather than for the implementation
team.

Copy this one-page template:

```markdown
# YYYY-MM-DD — Incident title

- Status: Resolved
- Severity: SEV-1 / SEV-2 / SEV-3
- Window: YYYY-MM-DD HH:MM–HH:MM UTC
- Affected surface: runtime / API / console / website
- Public status update: URL
- Tracking issue or PR: URL

## Summary And Impact

What users tried to do, what they saw, how many were affected, and for how long.
State unknowns explicitly.

## Timeline

- HH:MM — Detection
- HH:MM — User impact confirmed
- HH:MM — Mitigation started
- HH:MM — Recovery confirmed by production canary

## Root Cause

The technical and organizational conditions that made the incident possible.
Do not stop at the last failing line of code.

## Detection And Response

What detected the incident, what did not, and which response steps helped or
slowed recovery.

## Corrective Actions

- [ ] Owner — action — due date
- [ ] Owner — regression check or canary change — due date

## Lessons

What should change in the product, release process, or operating assumptions.
```
