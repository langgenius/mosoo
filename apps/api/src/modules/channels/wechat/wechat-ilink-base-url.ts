const WECHAT_ILINK_DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";

const WECHAT_ILINK_ALLOWED_HOSTS = new Set(["ilinkai.weixin.qq.com"]);
const WECHAT_ILINK_LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function normalizeWeChatIlinkBaseUrl(value: string | null | undefined): string {
  const rawValue = value?.trim() || WECHAT_ILINK_DEFAULT_BASE_URL;
  let url: URL;

  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("WeChat iLink baseUrl must be a valid URL.");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("WeChat iLink baseUrl must not include credentials, query, or fragment.");
  }

  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error("WeChat iLink baseUrl must not include a path.");
  }

  const isOfficial =
    url.protocol === "https:" && !url.port && WECHAT_ILINK_ALLOWED_HOSTS.has(url.hostname);
  const isLoopback =
    (url.protocol === "http:" || url.protocol === "https:") &&
    WECHAT_ILINK_LOOPBACK_HOSTS.has(url.hostname);

  if (!isOfficial && !isLoopback) {
    throw new Error(
      "WeChat iLink baseUrl must target the official iLink HTTPS origin or a loopback host.",
    );
  }

  return url.origin;
}
