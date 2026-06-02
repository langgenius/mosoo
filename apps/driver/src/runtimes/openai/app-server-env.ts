export const MOSOO_OPENAI_RUNTIME_SANDBOX_MODE = "danger-full-access";

const OPENAI_RUNTIME_PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
] as const;

export function summarizeOpenAiProxyEnv(
  env: NodeJS.ProcessEnv,
): Record<(typeof OPENAI_RUNTIME_PROXY_ENV_KEYS)[number], boolean> {
  return {
    ALL_PROXY: Boolean(env["ALL_PROXY"]),
    HTTPS_PROXY: Boolean(env["HTTPS_PROXY"]),
    HTTP_PROXY: Boolean(env["HTTP_PROXY"]),
    NO_PROXY: Boolean(env["NO_PROXY"]),
  };
}
