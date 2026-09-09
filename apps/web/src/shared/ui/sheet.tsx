import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps, ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { XIcon } from "@/shared/ui/icons";

function Sheet({ ...props }: ComponentProps<typeof DialogPrimitive.Root>): ReactElement {
  return <DialogPrimitive.Root {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Backdrop>): ReactElement {
  return (
    <DialogPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-ink-900/40 data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:animate-in data-[open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

type SheetSide = "left" | "right";

// The edge the sheet is anchored to also decides which way it slides. The two
// enter/exit animations are separate utilities that class merging cannot
// reconcile, so callers pick a side instead of overriding the classes.
const SHEET_SIDE_CLASS: Record<SheetSide, string> = {
  left: "left-0 data-[closed]:slide-out-to-left data-[open]:slide-in-from-left",
  right: "right-0 data-[closed]:slide-out-to-right data-[open]:slide-in-from-right",
};

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & { side?: SheetSide }): ReactElement {
  const { t } = useTranslation();

  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-50 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col bg-background shadow-xl duration-300 outline-none data-[closed]:animate-out data-[open]:animate-in",
          SHEET_SIDE_CLASS[side],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="sheet-close"
          className="text-fg-3 hover:bg-hover hover:text-fg-1 focus-visible:ring-ring focus-visible:ring-offset-background absolute top-3.5 right-3.5 flex size-7 items-center justify-center rounded-sm transition-[background-color,color] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <XIcon />
          <span className="sr-only">{t("common.close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactElement {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[16px] leading-snug font-semibold text-fg-heading", className)}
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetTitle };
