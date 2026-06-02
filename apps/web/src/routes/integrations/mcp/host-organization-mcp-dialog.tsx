import { ChevronDown, Shield, Users } from "lucide-react";
import { useState } from "react";

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

export function HostOrganizationMcpDialog({ open, onOpenChange, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  // V1 default: per-user for stronger isolation.
  const [scope, setScope] = useState<McpCredentialScope>("user");
  // When scope === "user", either "oauth" or "bearer" makes sense.
  // When scope === "organization_shared", V1 only supports "bearer".
  const [authType, setAuthType] = useState<McpAuthType>("oauth");
  const [sharedToken, setSharedToken] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setName("");
    setUrl("");
    setDescription("");
    setIconUrl("");
    setScope("user");
    setAuthType("oauth");
    setSharedToken("");
    setAdvancedOpen(false);
    setOauthClientId("");
    setOauthClientSecret("");
    setSubmitError(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  function handleScopeChange(next: McpCredentialScope) {
    setScope(next);
    // When switching to Service Account, V1 only supports Bearer.
    if (next === "organization_shared") {
      setAuthType("bearer");
    }
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
    setSubmitError(null);
    setSubmitting(true);

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
      setSubmitError(error instanceof Error ? error.message : "Failed to host organization MCP.");
    } finally {
      setSubmitting(false);
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
          {/* Name + icon preview */}
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
                  setName(e.target.value);
                }}
                placeholder="For example: Company Jira"
              />
            </div>
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="host-url">Server URL</Label>
            <Input
              id="host-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
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

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="host-desc">Description (optional)</Label>
            <Textarea
              id="host-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={2}
              placeholder="Describe what this MCP server provides so the team can understand it"
            />
          </div>

          {/* Credential scope selector (CORE) */}
          <div className="space-y-1.5">
            <Label>Credential mode</Label>
            <div className="grid gap-2">
              <ScopeRadio
                selected={scope === "user"}
                onSelect={() => {
                  handleScopeChange("user");
                }}
                icon={<Users className="size-4" />}
                title="Per-user authorization"
                subtitle="Each member authorizes with their own credential, keeping data isolated by user identity"
                extra={
                  scope === "user" && (
                    <div className="pt-2 pl-6">
                      <div className="flex items-center gap-2">
                        {(["oauth", "bearer"] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setAuthType(t);
                            }}
                            className={cn(
                              "rounded-md border px-3 py-1.5 text-[12px] transition",
                              authType === t
                                ? "border-primary bg-primary/5 text-foreground"
                                : "border-border text-muted-foreground hover:bg-muted/40",
                            )}
                          >
                            {t === "oauth" ? "OAuth" : "Bearer Token"}
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
                  handleScopeChange("organization_shared");
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
                          setSharedToken(e.target.value);
                        }}
                        placeholder="Paste the service account token"
                      />
                      <p className="text-muted-foreground text-[10px]">
                        Stored encrypted. Members can call the MCP server but cannot view the raw
                        token.
                      </p>
                    </div>
                  )
                }
              />
            </div>
          </div>

          {/* Advanced */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setAdvancedOpen((v) => !v);
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
                  <Label htmlFor="host-icon">Icon URL (optional)</Label>
                  <Input
                    id="host-icon"
                    value={iconUrl}
                    onChange={(e) => {
                      setIconUrl(e.target.value);
                    }}
                    placeholder="https://logo.clearbit.com/example.com"
                  />
                </div>

                {scope === "user" && authType === "oauth" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="host-client-id">OAuth Client ID (optional)</Label>
                      <Input
                        id="host-client-id"
                        value={oauthClientId}
                        onChange={(e) => {
                          setOauthClientId(e.target.value);
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
                          setOauthClientSecret(e.target.value);
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
            {submitting ? "Saving..." : "Save and publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  extra?: React.ReactNode;
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
