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
    vp run env:init

# Install repository-managed Git hooks.
hooks-install:
    vp exec prek -c config/prek.toml install

# Check commit metadata on the current branch against origin/main.
commit-check:
    vp run commit:check

# Start the local development stack after applying local migrations.
dev:
    just db-migrate
    vp run dev

# Format repository files.
fmt:
    vp run fmt

# Check repository formatting without writing changes.
fmt-check:
    vp run fmt:check

# Check formatting for one file or directory.
fmt-check-path path:
    vp fmt --check "{{ path }}" --ignore-path .gitignore

# Lint the repository.
lint: fmt
    vp run lint

# Type-check the repository.
tc: lint
    vp run tc

# Type-check one workspace package.
tc-package package:
    vp run --filter "{{ package }}" tc

# Run the regular test suite.
test: lint
    vp run test

# Test one workspace package.
test-package package:
    vp run --filter "{{ package }}" test

# Run one Bun test file.
test-file path:
    vp exec bun test "{{ path }}"

# Run the full repository verification gate.
check:
    vp run check

# Build the repository.
build: test
    vp run build

# Regenerate GraphQL outputs.
graphql-codegen:
    vp run graphql:codegen

# Check that GraphQL generated outputs are current.
graphql-codegen-check:
    vp run graphql:codegen:check

# Regenerate the Drizzle database baseline.
db-regen:
    vp run db:regen

# Apply the local database baseline.
db-migrate:
    vp run db:migrate:local

# Generate Cloudflare binding types.
cf-types:
    vp run cf:types

# Find unused dependencies and exports.
knip:
    vp run knip

# Run React Doctor.
react-doctor:
    vp run react-doctor

# Run React Doctor against the current diff.
react-doctor-diff:
    vp run react-doctor:diff

# Write the React Doctor JSON report.
react-doctor-report:
    vp run react-doctor:report

# Regenerate the help documentation index.
help-docs-index:
    vp exec bun scripts/generate-help-docs-index.ts

# Verify the deterministic local acceptance path.
e2e-deterministic:
    vp run e2e:deterministic

# Verify local E2E harness contracts.
e2e-harness-contract:
    vp run e2e:harness-contract

# Run the live Agent Builder planner check.
e2e-agent-builder-live-planner:
    vp run e2e:agent-builder-live-planner

# Run the Agent Builder smoke check.
e2e-agent-builder-smoke:
    vp run e2e:agent-builder-smoke

# Run the Preview live smoke check.
e2e-preview-smoke:
    vp run e2e:preview-smoke

# Run the Preview live smoke check in headed mode.
e2e-preview-smoke-headed:
    ./e2e/run-preview-smoke.sh --headed

# Run the Preview latency check.
e2e-preview-latency:
    vp run e2e:preview-latency

# Verify runtime signal contracts.
e2e-signal-contract:
    vp run e2e:signal-contract

# Export the standalone Agent Driver repository.
driver-repo-export:
    vp run driver:repo:export

# Verify the Agent Driver submodule cutover.
driver-submodule-smoke:
    vp run driver:submodule:smoke

# Deploy API and Web production targets.
deploy: build
    vp run deploy

# Deploy the API production target.
deploy-api:
    vp run deploy:api

# Deploy the Web production target.
deploy-web:
    vp run deploy:web

# Remove generated local build and dependency directories.
clean:
    fd -u -t d -F node_modules . -X rm -rf
    fd -u -t d -F dist . -X rm -rf
    fd -u -t d -F .tmp . -X rm -rf
    fd -u -t d -F .angular . -X rm -rf
    fd -u -t d -F .wrangler . -X rm -rf
