import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Grid2X2, List } from "@/shared/ui/icons";

type ViewMode = "list" | "grid";

const MODES: ViewMode[] = ["list", "grid"];

function isViewMode(value: unknown): value is ViewMode {
  return value === "list" || value === "grid";
}

/**
 * Segmented single-choice control (docs/design/console-design-contract.md,
 * section 4): a Base UI radio group on a sunken track; the checked segment is
 * the raised white surface with the smallest shadow, so selection reads by
 * elevation and glyph tone rather than by colour. Arrow keys move the choice
 * and Tab lands on the checked segment, both provided by the primitive.
 */
export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const labels: Record<ViewMode, string> = {
    grid: t("common.gridView"),
    list: t("common.listView"),
  };

  return (
    <RadioGroup
      aria-label={t("common.listView")}
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-md bg-sunken p-0.5", className)}
      data-slot="view-toggle"
      onValueChange={(next) => {
        if (isViewMode(next)) {
          onChange(next);
        }
      }}
      value={value}
    >
      {MODES.map((mode) => {
        const Icon = mode === "list" ? List : Grid2X2;

        return (
          <Radio.Root
            key={mode}
            aria-label={labels[mode]}
            className="rounded-compact text-fg-3 hover:text-fg-1 focus-visible:ring-ring data-[checked]:bg-card data-[checked]:text-fg-1 flex h-full w-8 items-center justify-center transition-[background-color,color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 data-[checked]:shadow-xs"
            value={mode}
          >
            <Icon className="size-3.5" />
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}
