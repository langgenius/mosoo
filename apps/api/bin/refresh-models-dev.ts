import { writeFile } from "node:fs/promises";

import {
  MODELS_DEV_API_URL,
  MODELS_DEV_PROVIDER_IDS,
} from "../src/modules/cost/domain/models-dev-pricing";
import type {
  ModelsDevCost,
  ModelsDevPrices,
  ModelsDevRates,
} from "../src/modules/cost/domain/models-dev-pricing";

interface ModelsDevProvider {
  readonly models: Readonly<Record<string, { readonly cost?: ModelsDevCost }>>;
}

function selectRates(cost: ModelsDevRates): ModelsDevRates {
  const { input, output, cache_read, cache_write } = cost;
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(cache_read === undefined ? {} : { cache_read }),
    ...(cache_write === undefined ? {} : { cache_write }),
  };
}

export function selectModelsDevPrices(
  providers: Readonly<Record<string, ModelsDevProvider>>,
): ModelsDevPrices {
  return Object.fromEntries(
    Object.entries(MODELS_DEV_PROVIDER_IDS).map(([providerId, upstreamId]) => {
      const provider = providers[upstreamId];
      if (provider === undefined) throw new Error(`models.dev provider is missing: ${upstreamId}`);
      const models = Object.entries(provider.models).flatMap(([modelId, { cost }]) => {
        if (cost === undefined) return [];
        const tiers = cost.tiers
          ?.filter(({ tier }) => tier.type === "context")
          .map((tier) => Object.assign(selectRates(tier), { tier: tier.tier }));
        return [
          [
            modelId,
            {
              ...selectRates(cost),
              ...(tiers === undefined || tiers.length === 0 ? {} : { tiers }),
            },
          ],
        ];
      });
      return [providerId, Object.fromEntries(models)];
    }),
  );
}

if (import.meta.main) {
  const response = await fetch(MODELS_DEV_API_URL);
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
  const providers = (await response.json()) as Readonly<Record<string, ModelsDevProvider>>;
  const prices = selectModelsDevPrices(providers);
  const target = new URL("../src/modules/cost/data/models-dev.json", import.meta.url);
  await writeFile(target, `${JSON.stringify(prices, null, 2)}\n`);
  console.log(`Refreshed prices for ${Object.keys(prices).length} providers. Review the git diff.`);
}
