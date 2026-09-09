import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps, ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { XIcon } from "@/shared/ui/icons";

function Dialog({ ...props }: ComponentProps<typeof DialogPrimitive.Root>): ReactElement {
  return <DialogPrimitive.Root {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Backdrop>): ReactElement {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-ink-900/40 data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:animate-in data-[open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Popup> & {
  showCloseButton?: boolean;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-border bg-card p-6 shadow-lg duration-200 outline-none data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 sm:max-w-lg",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="text-fg-3 hover:bg-hover hover:text-fg-1 focus-visible:ring-ring focus-visible:ring-offset-background absolute top-3.5 right-3.5 flex size-7 items-center justify-center rounded-sm transition-[background-color,color] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t("common.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">): ReactElement {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: ComponentProps<"div"> & {
  showCloseButton?: boolean;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline">{t("common.close")}</Button>} />
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactElement {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-[16px] leading-5 font-semibold tracking-subtitle text-fg-heading",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactElement {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[13px] leading-5 text-fg-2", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
