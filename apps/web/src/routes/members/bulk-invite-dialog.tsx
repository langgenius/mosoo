import { Loader2, Upload, X } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { isTruthy } from "../../shared/lib/truthiness";
import type { BulkInviteResult } from "./use-members-access-model";
export function BulkInviteDialog({
  dragOver,
  emails,
  error,
  fileName,
  inviting,
  onFile,
  onInvite,
  onOpenChange,
  onReset,
  onSetDragOver,
  onSetEmails,
  open,
  parsing,
  result,
}: {
  dragOver: boolean;
  emails: string[];
  error: string | null;
  fileName: string | null;
  inviting: boolean;
  onFile: (file: File) => void;
  onInvite: () => void;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
  onSetDragOver: (dragOver: boolean) => void;
  onSetEmails: (emails: string[]) => void;
  open: boolean;
  parsing: boolean;
  result: BulkInviteResult | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          onReset();
        }
      }}
    >
      <DialogContent className="rounded-lg sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import members from CSV</DialogTitle>
          <DialogDescription>
            Drop a .csv or .txt file. We&apos;ll scan it for email addresses; no specific column
            order required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <label
            htmlFor="csv-upload"
            onDragOver={(event) => {
              event.preventDefault();
              onSetDragOver(true);
            }}
            onDragLeave={() => {
              onSetDragOver(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              onSetDragOver(false);
              const file = event.dataTransfer.files[0];
              if (file) {
                onFile(file);
              }
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragOver
                ? "border-accent-press bg-accent-soft"
                : "border-border bg-background hover:border-border-strong",
            )}
          >
            <input
              aria-label="Upload invite list"
              id="csv-upload"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onFile(file);
                }
              }}
            />
            <Upload className="text-muted-foreground size-5" />
            <div className="text-foreground text-[13px] font-semibold">
              {fileName ?? "Drag a .csv or .txt file here"}
            </div>
            <div className="text-muted-foreground text-[11.5px]">
              {isTruthy(fileName) ? "Drop another to replace" : "or click to browse"}
            </div>
          </label>

          {parsing ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 text-[12px]">
              <Loader2 className="size-3.5 animate-spin" />
              Scanning file…
            </div>
          ) : null}

          {isTruthy(error) ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-[12px]">
              {error}
            </div>
          ) : null}

          {emails.length > 0 ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-muted-foreground text-[11.5px] font-semibold tracking-wider uppercase">
                  Detected · {emails.length}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSetEmails([]);
                  }}
                  className="text-muted-foreground hover:text-destructive text-[11px]"
                >
                  Clear
                </button>
              </div>
              <div className="border-border bg-muted/30 max-h-[180px] overflow-y-auto rounded-lg border p-2">
                <div className="flex flex-wrap gap-1.5">
                  {emails.map((email) => (
                    <span
                      key={email}
                      className="border-border bg-background text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => {
                          onSetEmails(emails.filter((item) => item !== email));
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${email}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {result ? (
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-[12px]",
                result.failed.length === 0
                  ? "border border-accent-press/30 bg-accent-soft text-accent-press"
                  : "border-amber/30 bg-amber-bg text-amber-fg border",
              )}
            >
              Sent {result.success} invite{result.success === 1 ? "" : "s"}
              {result.failed.length > 0
                ? ` · ${result.failed.length} failed (${result.failed.slice(0, 3).join(", ")}${result.failed.length > 3 ? "…" : ""})`
                : ""}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              onReset();
            }}
            disabled={inviting}
          >
            Cancel
          </Button>
          <Button onClick={onInvite} disabled={inviting || emails.length === 0}>
            {inviting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Inviting…
              </>
            ) : (
              `Send ${emails.length || ""} invite${emails.length === 1 ? "" : "s"}`.trim()
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
