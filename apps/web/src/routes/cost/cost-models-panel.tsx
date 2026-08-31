import { Link } from "react-router-dom";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";

import {
  formatModelPricingSummary,
  modelColor,
  formatCompactNumber,
  formatCurrency,
  formatPlainPercent,
  summarizeCostVendors,
  tokensTotal,
} from "./cost-model";
import type { CostModelRow } from "./cost-model";

export function CostModelsPanel({ models }: { models: CostModelRow[] }) {
  const { t } = useTranslation();
  const totalCost = models.reduce((sum, model) => sum + model.totalCostUsd, 0);
  const vendors = summarizeCostVendors(models);

  return (
    <section className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="border-border bg-card rounded-lg border p-4">
          <h2 className="text-foreground mb-4 text-sm font-semibold">{t("cost.spendByModel")}</h2>
          <ModelDonut models={models} totalCost={totalCost} />
        </div>

        <div className="border-border bg-card rounded-lg border p-4">
          <h2 className="text-foreground mb-4 text-sm font-semibold">{t("cost.byVendor")}</h2>
          <div className="space-y-3">
            {vendors.map((vendor, index) => {
              const share = totalCost > 0 ? vendor.totalCostUsd / totalCost : 0;

              return (
                <div key={vendor.vendor}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <div className="text-foreground truncate font-medium">{vendor.vendor}</div>
                      <div className="text-muted-foreground text-xs">
                        {t("cost.vendorSummary", {
                          modelCount: String(vendor.modelCount),
                          requestCount: formatCompactNumber(vendor.requestCount),
                        })}
                      </div>
                    </div>
                    <div className="font-mono">{formatCurrency(vendor.totalCostUsd)}</div>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: vendorColor(index),
                        width: `${Math.max(2, share * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-border bg-card overflow-x-auto rounded-lg border">
        <div className="border-border bg-muted/30 text-muted-foreground grid min-w-[980px] grid-cols-[minmax(180px,1.2fr)_110px_100px_120px_90px_120px_120px_100px_100px] border-b px-4 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
          <div>{t("cost.model")}</div>
          <div>{t("cost.vendor")}</div>
          <div>{t("cost.requests")}</div>
          <div>{t("cost.tokens")}</div>
          <div>{t("cost.cacheHit")}</div>
          <div>{t("cost.inputOutput")}</div>
          <div>{t("cost.cacheReadWrite")}</div>
          <div className="text-right">{t("cost.cost")}</div>
          <div className="text-right">{t("cost.action")}</div>
        </div>
        {models.length === 0 ? (
          <div className="text-muted-foreground px-4 py-10 text-center text-sm">
            {t("cost.noModelCostEvents")}
          </div>
        ) : null}
        <div>
          {models.map((model) => {
            const share = totalCost > 0 ? model.totalCostUsd / totalCost : 0;
            const pricing = formatModelPricingSummary(model, t);

            return (
              <div
                key={`${model.provider}-${model.model}`}
                className="border-border grid min-w-[980px] grid-cols-[minmax(180px,1.2fr)_110px_100px_120px_90px_120px_120px_100px_100px] items-center border-b px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-foreground flex min-w-0 items-center gap-2 font-semibold">
                    <span className={cn("size-2.5 rounded-full", modelColor(model.model))} />
                    <span className="truncate">{model.model}</span>
                  </div>
                  <div className="text-muted-foreground truncate text-xs">{model.provider}</div>
                </div>
                <div>{model.vendor}</div>
                <div>{formatCompactNumber(model.requestCount)}</div>
                <div>
                  <div>{formatCompactNumber(tokensTotal(model))}</div>
                  <div className="text-muted-foreground text-xs">{formatPlainPercent(share)}</div>
                </div>
                <div>{pricing.cacheHitLabel}</div>
                <div className="font-mono text-xs">
                  {pricing.inputOutputPriceLabel}
                  <div className="text-muted-foreground">{t("cost.per1M")}</div>
                </div>
                <div className="font-mono text-xs">
                  {pricing.cacheReadPriceLabel}/{pricing.cacheWritePriceLabel}
                  <div className="text-muted-foreground">{t("cost.per1M")}</div>
                </div>
                <div className="text-right font-mono font-semibold">
                  {formatCurrency(model.totalCostUsd)}
                </div>
                <div className="text-right">
                  {pricing.needsPricingAction ? (
                    <Link
                      to="/providers"
                      className="border-amber/30 text-amber-fg hover:bg-amber-bg rounded-md border px-2 py-1 text-xs font-semibold"
                    >
                      {t("cost.setPricing")}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground text-xs">{t("cost.priced")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ModelDonut({ models, totalCost }: { models: CostModelRow[]; totalCost: number }) {
  const { t } = useTranslation();

  if (models.length === 0 || totalCost <= 0) {
    return (
      <div className="bg-muted/30 text-muted-foreground flex h-48 items-center justify-center rounded-lg text-sm">
        {t("cost.noModelSpend")}
      </div>
    );
  }

  let cursor = 0;
  const slices: string[] = [];

  for (const [index, model] of models.entries()) {
    const start = cursor;
    const span = (model.totalCostUsd / totalCost) * 100;
    cursor += span;
    slices.push(`${vendorColor(index)} ${start}% ${cursor}%`);
  }

  return (
    <div className="flex items-center gap-5">
      <div
        className="grid size-36 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(${slices.join(", ")})` }}
      >
        <div className="bg-card grid size-20 place-items-center rounded-full text-center">
          <span className="font-mono text-sm font-semibold">{formatCurrency(totalCost)}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {models.slice(0, 5).map((model, index) => (
          <div key={`${model.provider}-${model.model}`} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: vendorColor(index) }}
            />
            <span className="min-w-0 flex-1 truncate">{model.model}</span>
            <span className="font-mono">{formatCurrency(model.totalCostUsd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function vendorColor(index: number): string {
  // mosoo brand palette: green-600, sky, ink-700, amber, soil, ember. Reference
  // the design-system tokens so the chart tracks theme changes (incl. dark mode).
  const colors = [
    "var(--color-green-600)",
    "var(--color-sky)",
    "var(--color-ink-700)",
    "var(--color-amber)",
    "var(--color-soil)",
    "var(--color-ember)",
  ] as const;

  return colors[index % colors.length] ?? "var(--color-ink-700)";
}
