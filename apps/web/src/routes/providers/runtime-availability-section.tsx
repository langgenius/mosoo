import type { ReactElement } from "react";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { RuntimeIcon, hasRuntimeIcon } from "@/shared/ui/brand-icons";
import { DataRow } from "@/shared/ui/list-row";

import { listRuntimeAvailabilityRows } from "./runtime-availability-model";

// 40px data row per runtime. Ready is the success mark plus its text tone; a
// runtime without a key keeps fully legible muted text instead of a faded row.
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
          "flex min-w-0 shrink items-center gap-1.5 truncate text-[12px] font-medium",
          tone === "ready" ? "text-success-fg" : "text-fg-3",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "ready" ? "bg-success" : "bg-fg-muted",
          )}
        />
        <span className="truncate">{status}</span>
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
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3">
        <h2 className="text-fg-heading text-[14px] font-semibold">
          {t("providers.runtimeAvailability")}
        </h2>
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
