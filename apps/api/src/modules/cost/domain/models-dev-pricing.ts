export const MODELS_DEV_API_URL = "https://models.dev/api.json";

/** Mosoo provider identities mapped to their models.dev pricing source. */
export const MODELS_DEV_PROVIDER_IDS: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  deepseek: "deepseek",
  gemini: "google",
  kimi: "moonshotai",
  minimax: "minimax",
  openai: "openai",
  opencode: "opencode",
  qwen: "alibaba",
  zhipu: "zai",
};

export interface ModelsDevRates {
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_write?: number;
}

export interface ModelsDevContextTier extends ModelsDevRates {
  readonly tier: { readonly type: string; readonly size: number };
}

export interface ModelsDevCost extends ModelsDevRates {
  readonly tiers?: readonly ModelsDevContextTier[];
}

/** One prices-only snapshot, keyed by Mosoo provider and upstream model ID. */
export type ModelsDevPrices = Readonly<Record<string, Readonly<Record<string, ModelsDevCost>>>>;
