const MOSOO_DEFAULT_WEB_ORIGIN = "https://mosoo.ai";

function readViteOriginOverride(): string | null {
  const value = import.meta.env.VITE_CHANNEL_WEBHOOK_ORIGIN;

  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Origin used when rendering channel webhook URLs (Slack request_url, Lark /
 * Telegram webhook callback, etc.) for operators to paste into the channel
 * provider. Production browses the same hostname that receives webhooks, so
 * `globalThis.location.origin` already returns the correct value. Local dev
 * is reached over a Cloudflare Tunnel — Slack et al. cannot dial
 * `http://localhost:5173` — so `VITE_CHANNEL_WEBHOOK_ORIGIN` can override the
 * browse origin with the tunnel hostname.
 */
export function resolveChannelWebhookOrigin(): string {
  const override = readViteOriginOverride();

  if (override !== null) {
    return override;
  }

  if (typeof globalThis.location === "undefined") {
    return MOSOO_DEFAULT_WEB_ORIGIN;
  }

  return globalThis.location.origin;
}
