import type { ReactElement } from "react";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { RuntimeIcon, hasRuntimeIcon } from "@/shared/ui/brand-icons";
import { DataRow } from "@/shared/ui/list-row";

import { listRuntimeAvailabilityRows } from "./runtime-availability-model";

// 40px data row per runtime. The words carry the state ("Ready", "Needs key");
// there is no status light, and a runtime without a key keeps legible muted text.
function RuntimeRow({
  label,
  runtimeId,
  status,
  tone,
}: {
  label: string;
  runtimeId: string;
  status: string;
  tone: "muted" | "ready";
}): ReactElement {
  return (
    <DataRow tone="tinted" className="justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {hasRuntimeIcon(runtimeId) ? (
          <RuntimeIcon
            className="border-border-soft bg-card size-6 shrink-0 rounded-sm border p-0.5"
            runtimeId={runtimeId}
          />
        ) : null}
        <div className={cn("truncate font-medium", tone === "ready" ? "text-fg-1" : "text-fg-2")}>
          {label}
        </div>
      </div>
      <span
        className={cn(
          "min-w-0 shrink truncate text-[12px]",
          tone === "ready" ? "text-fg-2" : "text-fg-3",
        )}
      >
        {status}
      </span>
    </DataRow>
  );
}

// Shows which agent runtimes can launch given the keys configured in this Project.
// A runtime is ready when the active Project has a key for the vendor it resolves.
export function RuntimeAvailabilitySection({
  credentials,
}: {
  credentials: readonly VendorCredential[];
}): ReactElement {
  const { t } = useTranslation();
  const rows = listRuntimeAvailabilityRows(credentials, t);

  return (
    <section className="border-border bg-card rounded-lg border p-6">
      <div className="mb-3">
        <h2 className="t-section-title">{t("providers.runtimeAvailability")}</h2>
        <p className="text-fg-3 mt-1 text-[12px] leading-4">
          {t("providers.runtimeAvailabilityDescription")}
        </p>
      </div>
      <div className="space-y-2">
        {rows.map((runtime) => (
          <RuntimeRow
            key={runtime.runtimeId}
            label={runtime.label}
            runtimeId={runtime.runtimeId}
            status={runtime.status}
            tone={runtime.tone}
          />
        ))}
      </div>
    </section>
  );
}
