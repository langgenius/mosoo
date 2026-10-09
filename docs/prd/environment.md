# Environment

A reusable, Project-owned setup for Sessions: packages, a setup script, variables and a network policy.

## Promises

- An Environment declares exact-version public npm and PyPI packages, a setup script and environment variables. Each Project has one default Environment, which an Agent without its own choice, or an inline API Session, uses.
- A Session freezes the Environment revision it was created with. Later edits affect only new Sessions.
- Packages are built once per package set, outside Session startup, and restored before the Agent starts; the setup script then runs in each new Sandbox. A build, restore or setup-script failure, or a variable that has no value, blocks startup instead of running with a partial setup. mosoo never falls back to installing packages at runtime: until the build is ready, creating a Session or starting a turn that needs it fails with "Environment packages are being prepared".
- npm packages put their CLIs on `PATH` and CommonJS modules on `NODE_PATH`; PyPI packages put their scripts on `PATH` and modules on `PYTHONPATH`.
- Variable values are stored encrypted and shown only as a masked hint. Leaving a value blank on edit keeps the stored one.
- **Limited** network denies outbound traffic except the Environment's allowed hosts and mosoo's own control and storage endpoints, passes only HTTP(S), and stays fixed for the Session's lifetime. **Full** is unrestricted.

## Limits

- Packages come only from npm and pip; OS packages belong in the Driver image. The setup script is not a place to persist dependencies.
- Node.js ESM bare imports ignore `NODE_PATH`; code that needs `import "pkg"` must install it in its own project.
- Limited refuses to start with `HTTP_PROXY`, `HTTPS_PROXY` or `ALL_PROXY` set.
- Variables that runtimes manage, such as provider key and endpoint variables and the OpenCode and Pi configuration variables, are dropped from the Environment ([`runtime-vendor-env-policy.ts`](../../apps/api/src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-vendor-env-policy.ts)).
- Variable values reach the Sandbox as plain environment variables, so the Agent and any code it runs can read them. Keep model keys in Providers and tool tokens in MCP connections, which never enter the Sandbox.
- The Project default, or an Environment an Agent still uses, cannot be deleted. There is no duplicate or cross-Project reuse.
