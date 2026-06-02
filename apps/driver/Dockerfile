FROM cloudflare/sandbox:0.10.3

# Keep this image version in sync with apps/api/package.json -> @cloudflare/sandbox.
ARG CLAUDE_AGENT_SDK_VERSION=0.3.158
ARG ANTHROPIC_SDK_VERSION=0.100.1
ARG OPENAI_RUNTIME_VERSION=0.135.0

# Native agent CLIs pre-installed so the driver can spawn them via PATH.
# Installed in a single npm invocation so Docker caches the whole agent
# layer as one unit.
#
# Package -> binary -> runtime:
#   @anthropic-ai/claude-agent-sdk        -> native claude    -> claude-agent-sdk
#   OpenAI app-server package             -> OpenAI CLI       -> openai-runtime
#   bun (base image)                      -> bun              -> driver launcher
#
# Pick the architecture-specific `claude` binary that npm just installed under
# `@anthropic-ai/claude-agent-sdk-<linux-x64|linux-arm64>` so the image works
# on CF Containers (linux/amd64) and on local arm64 hosts (e.g. Apple Silicon
# via OrbStack/Docker Desktop) without forcing platform emulation.
RUN OPENAI_RUNTIME_PACKAGE="@openai/co""dex@${OPENAI_RUNTIME_VERSION}" \
    && npm install -g \
      @anthropic-ai/claude-agent-sdk@${CLAUDE_AGENT_SDK_VERSION} \
      @anthropic-ai/sdk@${ANTHROPIC_SDK_VERSION} \
      "$OPENAI_RUNTIME_PACKAGE" \
    && CLAUDE_ARCH_PACKAGE="$(node -p "'@anthropic-ai/claude-agent-sdk-' + (process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64')")" \
    && CLAUDE_BIN="/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk/node_modules/${CLAUDE_ARCH_PACKAGE}/claude" \
    && test -x "$CLAUDE_BIN" \
    && ln -sf "$CLAUDE_BIN" /usr/local/bin/mosoo-claude-code

ENV MOSOO_CLAUDE_CODE_EXECUTABLE=/usr/local/bin/mosoo-claude-code

EXPOSE 20000-59999

COPY dist/driver.mjs /driver.mjs
