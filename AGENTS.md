# AGENTS.md

- Follow `CONTRIBUTING.md` for setup, development, verification, generated files, Git/PR, migrations, and deployment.
- For product behavior or module-boundary changes, read only the relevant PRD and architecture sections before editing.
- Production D1 is append-only: never reset production or rewrite an applied migration; follow `CONTRIBUTING.md#database-and-migrations` and `docs/production-deploy-verification.md`.
- Destructive or data-rewrite migrations require explicit user approval plus a backup and rollback plan.
