# List human-facing repository commands.
default:
    just --list

# Prepare a new checkout for local development.
setup:
    git submodule update --init
    bun install --frozen-lockfile
    just env-init
    just hooks-install
    just db-migrate

# Create or complete local development environment variables.
env-init:
    bun apps/api/bin/init-dev-vars.ts

# Install repository-managed Git hooks.
hooks-install:
    ./node_modules/.bin/prek -c config/prek.toml install

# Check commit metadata on the current branch against origin/main.
commit-check:
    bun scripts/validate-commit-range.ts origin/main HEAD

# Start the local development stack after applying local migrations.
dev:
    just db-migrate
    bun run dev

# Format repository files.
fmt:
    bun run fmt

# Check repository formatting without writing changes.
fmt-check:
    bun run fmt:check

# Check local Markdown links and image references.
docs-check:
    bun run docs:check

# Check formatting for one file or directory.
fmt-check-path path:
    ./node_modules/.bin/vp fmt --check --ignore-path .gitignore "{{ path }}"

# Lint the repository.
lint: fmt-check
    bun run lint

# Type-check the repository.
tc: lint
    bun run tc

# Type-check one workspace package.
tc-package package:
    bun run --filter "{{ package }}" tc

# Run the regular test suite.
test: lint
    bun run test

# Test one workspace package.
test-package package:
    bun run --filter "{{ package }}" test

# Run one Bun test file.
test-file path:
    bun test "{{ path }}"

# Run the full repository verification gate.
check:
    bun run check

# Build the repository.
build: check
    bun run build

# Regenerate GraphQL outputs.
graphql-codegen:
    bun run graphql:codegen

# Check that GraphQL generated outputs are current.
graphql-codegen-check:
    bun run graphql:codegen:check

# Generate one append-only Drizzle migration. Pass --custom for data-only SQL.
db-generate name *args:
    bun run --filter @mosoo/db db:generate -- --name "{{ name }}" {{args}}

# Apply pending migrations to the existing local D1 state.
db-migrate:
    cd apps/api && ../../node_modules/.bin/vp exec wrangler d1 migrations apply DB --local

# Explicitly destroy local API D1 state, then apply the migration chain.
db-reset-local:
    rm -rf apps/api/.wrangler/state/v3/d1
    just db-migrate

# Generate Cloudflare binding types.
cf-types:
    bun run cf:types

# Find unused dependencies and exports.
knip:
    bun run knip

# Regenerate the canonical Public API OpenAPI artifact.
public-api-openapi:
    bun run public-api:openapi:generate

# Check Public API artifact freshness and v1 backward compatibility.
public-api-openapi-check:
    bun run public-api:contract:check

# Exercise saved-Agent v2 create, real tools/artifacts, follow-up, SSE, usage, and cancellation on stage.
public-api-session-workflow:
    bun scripts/public-api-session-workflow.ts

# Smoke the documented minimal Thread shape against configured non-production.
public-api-smoke:
    bun scripts/public-api-nonproduction-smoke.ts

# Run Playwright E2E specs, e.g. `just e2e e2e/cases/ui/sidebar.spec.ts`.
e2e *args:
    e2e/node_modules/.bin/playwright test --config e2e/playwright.config.ts {{args}}

# Update the Agent Driver submodule to upstream HEAD.
driver-update:
    git submodule update --init --remote --checkout apps/driver

# Deploy API and Web production targets.
deploy: check
    bun run deploy

# Build and validate both isolated staging Workers without publishing.
stage-preflight:
    #!/usr/bin/env bash
    set -euo pipefail
    ./node_modules/.bin/vp run --filter @mosoo/agent-driver build
    ./node_modules/.bin/vp run --filter @mosoo/web build
    (cd apps/api && ../../node_modules/.bin/vp exec wrangler deploy --env stage --minify --dry-run)
    (cd apps/web && ../../node_modules/.bin/vp exec wrangler deploy --env stage --dry-run)

# Publish a reviewed, clean staging candidate; follow docs/production-deploy-verification.md#staging.
# Does not apply migrations, upload model keys, or target production.
deploy-stage: stage-preflight
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
        echo "Commit and review the candidate before deploying staging." >&2
        exit 1
    fi
    stage_revision="$(git rev-parse HEAD)"
    stage_driver_revision="$(git -C apps/driver rev-parse HEAD)"
    stage_message="mosoo=$stage_revision driver=$stage_driver_revision"
    (cd apps/api && ../../node_modules/.bin/vp exec wrangler deploy --env stage --minify --containers-rollout immediate --tag "$stage_revision" --message "$stage_message")
    (cd apps/web && ../../node_modules/.bin/vp exec wrangler deploy --env stage --tag "$stage_revision" --message "$stage_message")

# Deploy the API production target.
deploy-api:
    bun run deploy:api

# Deploy the Web production target.
deploy-web:
    bun run deploy:web

# Remove generated local build and dependency directories.
clean:
    fd -u -t d -F node_modules . -X rm -rf
    fd -u -t d -F dist . -X rm -rf
    fd -u -t d -F .tmp . -X rm -rf
