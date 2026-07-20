# syntax=docker/dockerfile:1.7

ARG BUN_IMAGE=oven/bun:canary@sha256:b33cef99f3aca8cdeeedc4dcb71773422abe6cff9972846114b8adf10e8e2233
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
ARG DOCKER_CLI_IMAGE=docker:29-cli@sha256:be132a9f282288de4afaf63379dff75711fda0147c6b72a9df44e51841402144
ARG CADDY_IMAGE=caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

FROM ${NODE_IMAGE} AS node-runtime
FROM ${DOCKER_CLI_IMAGE} AS docker-cli
FROM ${CADDY_IMAGE} AS caddy

FROM ${BUN_IMAGE} AS build
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile && bun run build

FROM ${BUN_IMAGE} AS runtime
ARG BUILD_DATE
ARG VERSION=dev
ARG VCS_REF

LABEL org.opencontainers.image.title="Mosoo" \
      org.opencontainers.image.description="Self-hosted Mosoo agent runtime" \
      org.opencontainers.image.source="https://github.com/langgenius/mosoo" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="Apache-2.0"

# The base image pins the Debian repository snapshot; package revisions vary by architecture.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=node-runtime /usr/local/bin/node /opt/node/bin/node
ENV PATH="/opt/node/bin:${PATH}"
COPY . .
RUN --mount=type=cache,id=mosoo-bun-runtime-cache,target=/root/.bun/install/cache,from=build,source=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile --filter @mosoo/api --filter agent-driver \
    && test -x /app/apps/api/node_modules/.bin/wrangler \
    && node --version \
    && bun --version
COPY --from=build /app/apps/driver/dist /app/apps/driver/dist
COPY --from=build /app/apps/web/dist /app/apps/web/dist
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy

ENV MOSOO_DATA_DIR=/data \
    MOSOO_API_DEV_DOCKER_HOST=unix:///var/run/docker.sock \
    MOSOO_API_DEV_USE_DEFAULT_DOCKER=1 \
    MOSOO_RUNTIME_CONTROL_ORIGIN=http://172.17.0.1:8787 \
    MOSOO_WEB_BIND_IP=127.0.0.1 \
    MOSOO_WEB_PORT=8080 \
    WRANGLER_DEV_IP=127.0.0.1 \
    WRANGLER_DEV_PORT=8788 \
    WEB_ORIGIN=http://localhost:8080

VOLUME ["/data", "/app/apps/api/.wrangler"]
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10m --retries=5 \
  CMD web_host="${MOSOO_WEB_BIND_IP:-127.0.0.1}"; \
  case "${web_host}" in \
    "0.0.0.0") web_host="127.0.0.1" ;; \
    "::") web_host="[::1]" ;; \
    *:*) web_host="[${web_host}]" ;; \
  esac; \
  curl --fail --silent --show-error --max-time 4 "http://${web_host}:${MOSOO_WEB_PORT:-8080}/api/health"

ENTRYPOINT ["/usr/bin/tini", "--", "bun", "/app/docker/entrypoint.ts"]
