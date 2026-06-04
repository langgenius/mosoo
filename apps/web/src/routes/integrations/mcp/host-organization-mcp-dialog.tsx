import { ChevronDown, Shield, Users } from "lucide-react";
import { useReducer } from "react";
import type { Dispatch, ReactNode } from "react";

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
import type { McpAuthType, McpCredentialScope } from "./mcp-types";
export interface HostOrganizationMcpInput {
  name: string;
  url: string;
  description?: string;
  iconUrl?: string;
  credentialScope: McpCredentialScope;
  authType: McpAuthType;
  /** Only when credentialScope === "organization_shared" and authType === "bearer" */
  sharedBearerToken?: string;
  /** Only when credentialScope === "user" and authType === "oauth" (optional advanced) */
  oauthClientId?: string;
  oauthClientSecret?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: HostOrganizationMcpInput) => Promise<void> | void;
}

interface HostOrganizationMcpDialogState {
  advancedOpen: boolean;
  authType: McpAuthType;
  description: string;
  iconUrl: string;
  name: string;
  oauthClientId: string;
  oauthClientSecret: string;
  scope: McpCredentialScope;
  sharedToken: string;
  submitError: string | null;
  submitting: boolean;
  url: string;
}

type HostOrganizationMcpDialogAction =
  | { type: "changeAuthType"; authType: McpAuthType }
  | { type: "changeDescription"; description: string }
  | { type: "changeIconUrl"; iconUrl: string }
  | { type: "changeName"; name: string }
  | { type: "changeOauthClientId"; oauthClientId: string }
  | { type: "changeOauthClientSecret"; oauthClientSecret: string }
  | { type: "changeScope"; scope: McpCredentialScope }
  | { type: "changeSharedToken"; sharedToken: string }
  | { type: "changeUrl"; url: string }
  | { type: "reset" }
  | { type: "setSubmitError"; error: string | null }
  | { type: "setSubmitting"; submitting: boolean }
  | { type: "toggleAdvanced" };

type HostOrganizationMcpDialogDispatch = Dispatch<HostOrganizationMcpDialogAction>;

const HOST_ORGANIZATION_MCP_DIALOG_INITIAL_STATE: HostOrganizationMcpDialogState = {
  advancedOpen: false,
  authType: "oauth",
  description: "",
  iconUrl: "",
  name: "",
  oauthClientId: "",
  oauthClientSecret: "",
  scope: "user",
  sharedToken: "",
  submitError: null,
  submitting: false,
  url: "",
};

function hostOrganizationMcpDialogReducer(
  state: HostOrganizationMcpDialogState,
  action: HostOrganizationMcpDialogAction,
): HostOrganizationMcpDialogState {
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
    case "changeScope":
      return {
        ...state,
        authType: action.scope === "organization_shared" ? "bearer" : state.authType,
        scope: action.scope,
      };
    case "changeSharedToken":
      return { ...state, sharedToken: action.sharedToken };
    case "changeUrl":
      return { ...state, url: action.url };
    case "reset":
      return HOST_ORGANIZATION_MCP_DIALOG_INITIAL_STATE;
    case "setSubmitError":
      return { ...state, submitError: action.error };
    case "setSubmitting":
      return { ...state, submitting: action.submitting };
    case "toggleAdvanced":
      return { ...state, advancedOpen: !state.advancedOpen };
  }
}

export function HostOrganizationMcpDialog({ open, onOpenChange, onSubmit }: Props) {
  const [state, dispatch] = useReducer(
    hostOrganizationMcpDialogReducer,
    HOST_ORGANIZATION_MCP_DIALOG_INITIAL_STATE,
  );
  const {
    authType,
    description,
    iconUrl,
    name,
    oauthClientId,
    oauthClientSecret,
    scope,
    sharedToken,
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

  function handleScopeChange(next: McpCredentialScope) {
    dispatch({ scope: next, type: "changeScope" });
  }

  const urlValid = url.trim().startsWith("https://");
  const serviceAccountNeedsToken =
    scope === "organization_shared" && sharedToken.trim().length === 0;
  const canSubmit = name.trim().length > 0 && urlValid && !serviceAccountNeedsToken;

  async function handleSubmit() {
    if (!canSubmit || submitting) {
      return;
    }
    const trimmedDesc = description.trim();
    const trimmedIcon = iconUrl.trim();
    const trimmedToken = sharedToken.trim();
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
        credentialScope: scope,
        authType,
        ...(scope === "organization_shared" &&
          trimmedToken && {
            sharedBearerToken: trimmedToken,
          }),
        ...(scope === "user" &&
          authType === "oauth" &&
          trimmedClientId && { oauthClientId: trimmedClientId }),
        ...(scope === "user" &&
          authType === "oauth" &&
          trimmedClientSecret && { oauthClientSecret: trimmedClientSecret }),
      });
      handleOpenChange(false);
    } catch (error) {
      dispatch({
        error: error instanceof Error ? error.message : "Failed to host organization MCP.",
        type: "setSubmitError",
      });
    } finally {
      dispatch({ submitting: false, type: "setSubmitting" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Host organization MCP</DialogTitle>
          <DialogDescription>
            Host a Remote HTTPS MCP server for the whole organization. V1 supports HTTPS only; STDIO
            will arrive in a later version.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <HostOrganizationMcpFields dispatch={dispatch} state={state} urlValid={urlValid} />
          <HostOrganizationMcpCredentialSection
            dispatch={dispatch}
            onScopeChange={handleScopeChange}
            state={state}
          />
          <HostOrganizationMcpAdvancedSection dispatch={dispatch} state={state} />
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
            {submitting ? "Saving..." : "Save and publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HostOrganizationMcpFields({
  dispatch,
  state,
  urlValid,
}: {
  dispatch: HostOrganizationMcpDialogDispatch;
  state: HostOrganizationMcpDialogState;
  urlValid: boolean;
}) {
  const { description, iconUrl, name, url } = state;

  return (
    <>
      <div className="flex items-start gap-3">
        <IconAvatar
          url={iconUrl.trim() || undefined}
          serverUrl={url.trim() || undefined}
          name={name || "?"}
          size={44}
        />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="host-name">Name</Label>
          <Input
            id="host-name"
            value={name}
            onChange={(e) => {
              dispatch({ name: e.target.value, type: "changeName" });
            }}
            placeholder="For example: Company Jira"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="host-url">Server URL</Label>
        <Input
          id="host-url"
          value={url}
          onChange={(e) => {
            dispatch({ type: "changeUrl", url: e.target.value });
          }}
          placeholder="https://mcp.company.com/jira"
        />
        {url.length > 0 && !urlValid && (
          <p className="text-destructive text-[11px]">URL must start with https://</p>
        )}
        <p className="text-muted-foreground text-[11px]">
          Transport: Remote HTTPS (STDIO is planned for V2)
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="host-desc">Description (optional)</Label>
        <Textarea
          id="host-desc"
          value={description}
          onChange={(e) => {
            dispatch({ description: e.target.value, type: "changeDescription" });
          }}
          rows={2}
          placeholder="Describe what this MCP server provides so the team can understand it"
        />
      </div>
    </>
  );
}

function HostOrganizationMcpCredentialSection({
  dispatch,
  onScopeChange,
  state,
}: {
  dispatch: HostOrganizationMcpDialogDispatch;
  onScopeChange: (scope: McpCredentialScope) => void;
  state: HostOrganizationMcpDialogState;
}) {
  const { authType, scope, sharedToken } = state;

  return (
    <div className="space-y-1.5">
      <Label>Credential mode</Label>
      <div className="grid gap-2">
        <ScopeRadio
          selected={scope === "user"}
          onSelect={() => {
            onScopeChange("user");
          }}
          icon={<Users className="size-4" />}
          title="Per-user authorization"
          subtitle="Each member authorizes with their own credential, keeping data isolated by user identity"
          extra={
            scope === "user" && (
              <div className="pt-2 pl-6">
                <div className="flex items-center gap-2">
                  {(["oauth", "bearer"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        dispatch({ authType: type, type: "changeAuthType" });
                      }}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-[12px] transition",
                        authType === type
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {type === "oauth" ? "OAuth" : "Bearer Token"}
                    </button>
                  ))}
                </div>
              </div>
            )
          }
        />

        <ScopeRadio
          selected={scope === "organization_shared"}
          onSelect={() => {
            onScopeChange("organization_shared");
          }}
          icon={<Shield className="size-4" />}
          title="Service account (shared credential)"
          subtitle="Provide one bearer token now and let the whole organization share that identity"
          extra={
            scope === "organization_shared" && (
              <div className="space-y-1.5 pt-2 pl-6">
                <Label htmlFor="shared-token" className="text-[11px]">
                  Bearer Token
                </Label>
                <Input
                  id="shared-token"
                  type="password"
                  value={sharedToken}
                  onChange={(e) => {
                    dispatch({ sharedToken: e.target.value, type: "changeSharedToken" });
                  }}
                  placeholder="Paste the service account token"
                />
                <p className="text-muted-foreground text-[10px]">
                  Stored encrypted. Members can call the MCP server but cannot view the raw token.
                </p>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}

function HostOrganizationMcpAdvancedSection({
  dispatch,
  state,
}: {
  dispatch: HostOrganizationMcpDialogDispatch;
  state: HostOrganizationMcpDialogState;
}) {
  const { advancedOpen, authType, iconUrl, oauthClientId, oauthClientSecret, scope } = state;

  return (
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

      {advancedOpen ? (
        <div className="border-border bg-muted/30 mt-3 space-y-4 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="host-icon">Icon URL (optional)</Label>
            <Input
              id="host-icon"
              value={iconUrl}
              onChange={(e) => {
                dispatch({ iconUrl: e.target.value, type: "changeIconUrl" });
              }}
              placeholder="https://logo.clearbit.com/example.com"
            />
          </div>

          {scope === "user" && authType === "oauth" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="host-client-id">OAuth Client ID (optional)</Label>
                <Input
                  id="host-client-id"
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
                <Label htmlFor="host-client-secret">OAuth Client Secret (optional)</Label>
                <Input
                  id="host-client-secret"
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScopeRadio({
  selected,
  onSelect,
  icon,
  title,
  subtitle,
  extra,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      onClick={onSelect}
      className={cn(
        "group rounded-md border px-3 py-2.5 text-left transition",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 size-3.5 rounded-full border flex items-center justify-center shrink-0",
            selected ? "border-primary" : "border-muted-foreground/40",
          )}
        >
          {selected && <span className="bg-primary size-1.5 rounded-full" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-foreground flex items-center gap-1.5 text-[13px] font-medium">
            {icon}
            {title}
          </div>
          <p className="text-muted-foreground mt-0.5 text-[11px]">{subtitle}</p>
          {extra}
        </div>
      </div>
    </button>
  );
}
