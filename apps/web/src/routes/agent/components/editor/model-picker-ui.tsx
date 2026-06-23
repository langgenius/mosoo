import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import {
  ADD_PROVIDER_KEY_TEXT,
  PROVIDER_KEY_REQUIRED_TEXT,
} from "@/domains/vendor-credential/model/provider-readiness-copy";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";

import type { ResolvedModelEntry } from "../../../../domains/vendor-credential/api/vendor-credential-client";

export function ModelProviderLink({ lockedVendors }: { lockedVendors: string[] }): ReactElement {
  const quickNavLabel = lockedVendors.length > 0 ? ADD_PROVIDER_KEY_TEXT : "Manage Providers";
  const title =
    lockedVendors.length > 0
      ? `${PROVIDER_KEY_REQUIRED_TEXT}: ${lockedVendors.join(", ")}`
      : undefined;

  return (
    <Link
      className="text-muted-foreground flex w-full items-center gap-1.5 text-[12px]"
      to="/providers"
      title={title}
    >
      <ExternalLink className="size-3" />
      {quickNavLabel}
    </Link>
  );
}

export function ModelPickerEmptyItem(): ReactElement {
  return (
    <div className="text-muted-foreground px-3 py-6 text-center text-[12px]">
      No matching models. Configure a Provider to unlock models.
    </div>
  );
}

export function ModelPickerItem({
  entry,
  onPick,
  selected,
}: {
  entry: ResolvedModelEntry;
  onPick(): void;
  selected: boolean;
}): ReactElement {
  const tooltip = entry.statusDetail ?? entry.statusLabel;

  return (
    <DropdownMenuItem
      className={cn(
        "flex flex-col items-start gap-0.5 py-2",
        entry.available ? null : "bg-muted/40 text-muted-foreground opacity-100",
        selected ? "bg-ink-100" : null,
      )}
      disabled={!entry.available}
      onSelect={(event) => {
        if (entry.available) {
          onPick();
          return;
        }
        event.preventDefault();
      }}
      title={tooltip}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            entry.available ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {entry.displayName}
        </span>
        <ModelStateBadge entry={entry} />
      </div>
      <div className="text-muted-foreground flex w-full items-center justify-between gap-2 text-[11px]">
        <span>
          {entry.vendorLabel} · {entry.modelId}
        </span>
        {entry.available ? null : (
          <span className="text-muted-foreground min-w-0 truncate">{entry.statusDetail}</span>
        )}
      </div>
    </DropdownMenuItem>
  );
}

function ModelStateBadge({ entry }: { entry: ResolvedModelEntry }): ReactElement {
  if (entry.available) {
    return <Badge variant="success">{entry.statusLabel}</Badge>;
  }

  return <Badge variant="outline">{entry.statusLabel}</Badge>;
}
