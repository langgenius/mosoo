import { ChevronDown } from "lucide-react";
import { useReducer } from "react";

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
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

import { isTruthy } from "../../../shared/lib/truthiness";
import { IconAvatar } from "./icon-avatar";
interface AddMcpInput {
  name: string;
  url: string;
  description?: string;
  iconUrl?: string;
  authType: "oauth" | "bearer";
  oauthClientId?: string;
  oauthClientSecret?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AddMcpInput) => Promise<void> | void;
}

interface AddMcpDialogState {
  advancedOpen: boolean;
  authType: "oauth" | "bearer";
  description: string;
  iconUrl: string;
  name: string;
  oauthClientId: string;
  oauthClientSecret: string;
  submitError: string | null;
  submitting: boolean;
  url: string;
}

type AddMcpDialogAction =
  | { type: "changeAuthType"; authType: "oauth" | "bearer" }
  | { type: "changeDescription"; description: string }
  | { type: "changeIconUrl"; iconUrl: string }
  | { type: "changeName"; name: string }
  | { type: "changeOauthClientId"; oauthClientId: string }
  | { type: "changeOauthClientSecret"; oauthClientSecret: string }
  | { type: "changeUrl"; url: string }
  | { type: "reset" }
  | { type: "setSubmitError"; error: string | null }
  | { type: "setSubmitting"; submitting: boolean }
  | { type: "toggleAdvanced" };

const ADD_MCP_DIALOG_INITIAL_STATE: AddMcpDialogState = {
  advancedOpen: false,
  authType: "oauth",
  description: "",
  iconUrl: "",
  name: "",
  oauthClientId: "",
  oauthClientSecret: "",
  submitError: null,
  submitting: false,
  url: "",
};

function addMcpDialogReducer(
  state: AddMcpDialogState,
  action: AddMcpDialogAction,
): AddMcpDialogState {
  switch (action.type) {
    case "changeAuthType":
      return { ...state, authType: action.authType };
    case "changeDescription":
      return { ...state, description: action.description };
    case "changeIconUrl":
      return { ...state, iconUrl: action.iconUrl };
    case "changeName":
      return { ...state, name: action.name };
    case "changeOauthClientId":
      return { ...state, oauthClientId: action.oauthClientId };
    case "changeOauthClientSecret":
      return { ...state, oauthClientSecret: action.oauthClientSecret };
    case "changeUrl":
      return { ...state, url: action.url };
    case "reset":
      return ADD_MCP_DIALOG_INITIAL_STATE;
    case "setSubmitError":
      return { ...state, submitError: action.error };
    case "setSubmitting":
      return { ...state, submitting: action.submitting };
    case "toggleAdvanced":
      return { ...state, advancedOpen: !state.advancedOpen };
  }
}

export function AddMcpDialog({ open, onOpenChange, onSubmit }: Props) {
  const [state, dispatch] = useReducer(addMcpDialogReducer, ADD_MCP_DIALOG_INITIAL_STATE);
  const {
    advancedOpen,
    authType,
    description,
    iconUrl,
    name,
    oauthClientId,
    oauthClientSecret,
    submitError,
    submitting,
    url,
  } = state;

  function reset() {
    dispatch({ type: "reset" });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  const urlValid = url.trim().startsWith("https://");
  const canSubmit = name.trim().length > 0 && urlValid;

  async function handleSubmit() {
    if (!canSubmit || submitting) {
      return;
    }
    const trimmedDesc = description.trim();
    const trimmedIcon = iconUrl.trim();
    const trimmedClientId = oauthClientId.trim();
    const trimmedClientSecret = oauthClientSecret.trim();
    dispatch({ error: null, type: "setSubmitError" });
    dispatch({ submitting: true, type: "setSubmitting" });

    try {
      await onSubmit({
        name: name.trim(),
        url: url.trim(),
        ...(trimmedDesc && { description: trimmedDesc }),
        ...(trimmedIcon && { iconUrl: trimmedIcon }),
        authType,
        ...(trimmedClientId && { oauthClientId: trimmedClientId }),
        ...(trimmedClientSecret && { oauthClientSecret: trimmedClientSecret }),
      });
      handleOpenChange(false);
    } catch (error) {
      dispatch({
        error: error instanceof Error ? error.message : "Failed to add MCP connection.",
        type: "setSubmitError",
      });
    } finally {
      dispatch({ submitting: false, type: "setSubmitting" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add MCP connection</DialogTitle>
          <DialogDescription>
            Add an MCP server over Remote HTTPS. Authorization starts immediately after you save.
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
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
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
            <Label htmlFor="mcp-url">Server URL</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => {
                dispatch({ type: "changeUrl", url: e.target.value });
              }}
              placeholder="https://mcp.figma.com/mcp"
            />
            {url.length > 0 && !urlValid && (
              <p className="text-destructive text-[11px]">URL must start with https://</p>
            )}
          </div>

          {/* Auth type selector */}
          <div className="space-y-1.5">
            <Label>Authorization</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["oauth", "bearer"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    dispatch({ authType: t, type: "changeAuthType" });
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-[13px] text-left transition",
                    authType === t
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <div className="text-foreground font-medium">
                    {t === "oauth" ? "OAuth" : "Bearer token"}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-[11px]">
                    {t === "oauth" ? "Authorize with the provider" : "Paste a token"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced settings */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "toggleAdvanced" });
              }}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[12px] transition"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
              />
              Advanced settings
            </button>

            {advancedOpen && (
              <div className="border-border bg-muted/30 mt-3 space-y-4 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-icon">Icon URL (optional)</Label>
                  <Input
                    id="mcp-icon"
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

                <div className="space-y-1.5">
                  <Label htmlFor="mcp-desc">Description (optional)</Label>
                  <Textarea
                    id="mcp-desc"
                    value={description}
                    onChange={(e) => {
                      dispatch({ description: e.target.value, type: "changeDescription" });
                    }}
                    rows={2}
                    placeholder="What capabilities does this MCP server provide?"
                  />
                </div>

                {authType === "oauth" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-client-id">OAuth Client ID (optional)</Label>
                      <Input
                        id="mcp-client-id"
                        value={oauthClientId}
                        onChange={(e) => {
                          dispatch({
                            oauthClientId: e.target.value,
                            type: "changeOauthClientId",
                          });
                        }}
                        placeholder="Leave empty to use dynamic client registration"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-client-secret">OAuth Client Secret (optional)</Label>
                      <Input
                        id="mcp-client-secret"
                        type="password"
                        value={oauthClientSecret}
                        onChange={(e) => {
                          dispatch({
                            oauthClientSecret: e.target.value,
                            type: "changeOauthClientSecret",
                          });
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
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
          <Button disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Adding..." : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
