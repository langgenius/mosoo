import { useState } from "react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { McpServerWithCredential } from "./mcp-types";
interface ServiceAccountCredentialInput {
  subjectLabel?: string;
  token: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ServiceAccountCredentialInput) => Promise<void> | void;
  server: McpServerWithCredential | null;
}

export function ServiceAccountCredentialDialog({ open, onOpenChange, onSubmit, server }: Props) {
  const [subjectLabel, setSubjectLabel] = useState("");
  const [token, setToken] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSubjectLabel("");
    setToken("");
    setSubmitError(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  async function handleSubmit() {
    if (!server || token.trim().length === 0 || submitting) {
      return;
    }

    setSubmitError(null);
    setSubmitting(true);

    try {
      await onSubmit({
        token: token.trim(),
        ...(subjectLabel.trim() && { subjectLabel: subjectLabel.trim() }),
      });
      handleOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Failed to save service account credential.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const verb = server?.hasSharedCredential === true ? "Replace" : "Set";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{verb} service account credential</DialogTitle>
          <DialogDescription>
            Store one encrypted bearer token for {server?.name ?? "this MCP server"}. Members can
            use the server without seeing the raw token.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="service-account-label">Subject label (optional)</Label>
            <Input
              id="service-account-label"
              value={subjectLabel}
              onChange={(event) => {
                setSubjectLabel(event.target.value);
              }}
              placeholder="For example: Jira service account"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="service-account-token">Bearer Token</Label>
            <Input
              id="service-account-token"
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
              }}
              placeholder="Paste the service account token"
            />
          </div>
        </div>

        <DialogFooter>
          {isTruthy(submitError) ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive w-full rounded-md border px-3 py-2 text-xs">
              {submitError}
            </div>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button disabled={token.trim().length === 0 || submitting} onClick={handleSubmit}>
            {submitting ? "Saving..." : "Save credential"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
