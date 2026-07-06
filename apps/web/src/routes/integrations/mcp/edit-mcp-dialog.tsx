import { useReducer } from "react";

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
import { Textarea } from "@/shared/ui/textarea";

import { isTruthy } from "../../../shared/lib/truthiness";
import { authTypeLabel } from "./format";
import { IconAvatar } from "./icon-avatar";
import type { McpServerWithCredential } from "./mcp-types";

interface EditMcpInput {
  name: string;
  url: string;
  description: string | null;
  iconUrl: string | null;
}

interface Props {
  server: McpServerWithCredential;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: EditMcpInput) => Promise<void> | void;
}

interface EditMcpDialogState {
  description: string;
  iconUrl: string;
  name: string;
  submitError: string | null;
  submitting: boolean;
  url: string;
}

type EditMcpDialogAction =
  | { type: "changeDescription"; description: string }
  | { type: "changeIconUrl"; iconUrl: string }
  | { type: "changeName"; name: string }
  | { type: "changeUrl"; url: string }
  | { type: "setSubmitError"; error: string | null }
  | { type: "setSubmitting"; submitting: boolean };

function createInitialState(server: McpServerWithCredential): EditMcpDialogState {
  return {
    description: server.description ?? "",
    iconUrl: server.iconUrl ?? "",
    name: server.name,
    submitError: null,
    submitting: false,
    url: server.url,
  };
}

function editMcpDialogReducer(
  state: EditMcpDialogState,
  action: EditMcpDialogAction,
): EditMcpDialogState {
  switch (action.type) {
    case "changeDescription":
      return { ...state, description: action.description };
    case "changeIconUrl":
      return { ...state, iconUrl: action.iconUrl };
    case "changeName":
      return { ...state, name: action.name };
    case "changeUrl":
      return { ...state, url: action.url };
    case "setSubmitError":
      return { ...state, submitError: action.error };
    case "setSubmitting":
      return { ...state, submitting: action.submitting };
  }
}

export function EditMcpDialog({ server, onOpenChange, onSubmit }: Props) {
  const [state, dispatch] = useReducer(editMcpDialogReducer, server, createInitialState);
  const { description, iconUrl, name, submitError, submitting, url } = state;

  const urlValid = url.trim().startsWith("https://");
  const canSubmit = name.trim().length > 0 && urlValid;
  const urlChanged = url.trim() !== server.url;
  const disconnectsOnSave = urlChanged && server.credentialStatus === "active";

  async function handleSubmit() {
    if (!canSubmit || submitting) {
      return;
    }
    const trimmedDesc = description.trim();
    const trimmedIcon = iconUrl.trim();
    dispatch({ error: null, type: "setSubmitError" });
    dispatch({ submitting: true, type: "setSubmitting" });

    try {
      await onSubmit({
        description: trimmedDesc.length > 0 ? trimmedDesc : null,
        iconUrl: trimmedIcon.length > 0 ? trimmedIcon : null,
        name: name.trim(),
        url: url.trim(),
      });
      onOpenChange(false);
    } catch (error) {
      dispatch({
        error: error instanceof Error ? error.message : "Failed to update MCP connection.",
        type: "setSubmitError",
      });
    } finally {
      dispatch({ submitting: false, type: "setSubmitting" });
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit MCP connection</DialogTitle>
          <DialogDescription>
            Update this MCP server. Authorization type ({authTypeLabel(server.authType)}) cannot be
            changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name + icon preview */}
          <div className="flex items-start gap-3">
            <IconAvatar
              url={iconUrl.trim() || undefined}
              serverUrl={url.trim() || undefined}
              name={name || "?"}
              size={44}
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="mcp-edit-name">Name</Label>
              <Input
                id="mcp-edit-name"
                value={name}
                onChange={(e) => {
                  dispatch({ name: e.target.value, type: "changeName" });
                }}
                placeholder="For example: Figma"
              />
            </div>
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-edit-url">Server URL</Label>
            <Input
              id="mcp-edit-url"
              value={url}
              onChange={(e) => {
                dispatch({ type: "changeUrl", url: e.target.value });
              }}
              placeholder="https://mcp.figma.com/mcp"
            />
            {url.length > 0 && !urlValid && (
              <p className="text-destructive text-[11px]">URL must start with https://</p>
            )}
            {disconnectsOnSave && (
              <p className="text-amber-fg text-[11px]">
                Changing the URL disconnects the current credential. You will need to connect again.
              </p>
            )}
          </div>

          {/* Icon URL */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-edit-icon">Icon URL (optional)</Label>
            <Input
              id="mcp-edit-icon"
              value={iconUrl}
              onChange={(e) => {
                dispatch({ iconUrl: e.target.value, type: "changeIconUrl" });
              }}
              placeholder="https://logo.clearbit.com/example.com"
            />
            <p className="text-muted-foreground text-[10px]">
              Leave empty to use the initial as the icon.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-edit-desc">Description (optional)</Label>
            <Textarea
              id="mcp-edit-desc"
              value={description}
              onChange={(e) => {
                dispatch({ description: e.target.value, type: "changeDescription" });
              }}
              rows={2}
              placeholder="What capabilities does this MCP server provide?"
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
              onOpenChange(false);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
