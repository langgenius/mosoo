import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";

/**
 * Segmented single choice between a few text options
 * (docs/design/console-design-contract.md, section 4): the ViewToggle recipe
 * with text segments. A Base UI radio group on the sunken track; the checked
 * segment is the raised white surface with the smallest shadow, so selection
 * reads by elevation and tone, never by colour.
 */
export function SegmentedControl<T extends string>({
  className,
  label,
  onChange,
  options,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: T) => void;
  options: readonly { label: string; value: T }[];
  value: T;
}): ReactElement {
  return (
    <RadioGroup
      aria-label={label}
      className={cn(
        "bg-sunken inline-flex h-8 w-full min-w-0 items-center gap-0.5 rounded-md p-0.5 sm:w-auto",
        className,
      )}
      data-slot="segmented-control"
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) {
          onChange(option.value);
        }
      }}
      value={value}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          className="text-fg-2 hover:text-fg-1 focus-visible:ring-ring data-[checked]:bg-card data-[checked]:text-fg-1 inline-flex h-full min-w-0 flex-1 cursor-default items-center justify-center rounded-sm px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out outline-none focus-visible:ring-2 data-[checked]:shadow-xs sm:flex-none"
          value={option.value}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
