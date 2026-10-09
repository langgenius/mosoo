import type { CreateProjectMcpServerInput, McpAuthType } from "@mosoo/contracts/mcp";
import { useState } from "react";

import { useTranslation } from "@/shared/i18n";
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
import { ChevronDown } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";

import { isTruthy } from "../../../shared/lib/truthiness";
import { IconAvatar } from "./icon-avatar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: Omit<CreateProjectMcpServerInput, "projectId">) => Promise<void> | void;
}

interface AddMcpForm {
  advancedOpen: boolean;
  authType: McpAuthType;
  description: string;
  iconUrl: string;
  name: string;
  oauthClientId: string;
  oauthClientSecret: string;
  url: string;
}

const EMPTY_FORM: AddMcpForm = {
  advancedOpen: false,
  authType: "oauth",
  description: "",
  iconUrl: "",
  name: "",
  oauthClientId: "",
  oauthClientSecret: "",
  url: "",
};

export function AddMcpDialog({ open, onOpenChange, onSubmit }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const {
    advancedOpen,
    authType,
    description,
    iconUrl,
    name,
    oauthClientId,
    oauthClientSecret,
    url,
  } = form;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setForm(EMPTY_FORM);
      setSubmitError(null);
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
    setSubmitError(null);
    setSubmitting(true);

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
      setSubmitError(error instanceof Error ? error.message : t("mcp.failedToAdd"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("mcp.addConnection")}</DialogTitle>
          <DialogDescription>{t("mcp.addDescription")} </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto py-2 pr-1">
          {/* Name + icon preview */}
          <div className="flex items-start gap-3">
            <IconAvatar
              url={iconUrl.trim() || undefined}
              serverUrl={url.trim() || undefined}
              name={name || "?"}
              size={44}
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="mcp-name">{t("mcp.name")}</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                }}
                placeholder={t("mcp.namePlaceholder")}
              />
            </div>
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-url">{t("mcp.serverUrl")}</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => {
                setForm({ ...form, url: e.target.value });
              }}
              placeholder="https://mcp.figma.com/mcp"
            />
            {url.length > 0 && !urlValid && (
              <p className="text-danger text-[11px]">{t("mcp.urlMustStartWithHttps")}</p>
            )}
          </div>

          {/* Auth type selector */}
          <div className="space-y-1.5">
            <Label>{t("mcp.authorization")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["oauth", "bearer"] as const).map((authTypeOption) => (
                <button
                  key={authTypeOption}
                  type="button"
                  onClick={() => {
                    setForm({ ...form, authType: authTypeOption });
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-[13px] text-left transition",
                    authType === authTypeOption
                      ? "border-emphasis bg-selected text-fg-1"
                      : "border-border text-fg-3 hover:bg-sunken/40",
                  )}
                >
                  <div className="text-foreground font-medium">
                    {authTypeOption === "oauth" ? t("mcp.oauth") : t("mcp.bearerToken")}
                  </div>
                  <div className="text-fg-3 mt-0.5 text-[11px]">
                    {authTypeOption === "oauth"
                      ? t("mcp.authorizeWithProvider")
                      : t("mcp.pasteAToken")}
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
                setForm({ ...form, advancedOpen: !advancedOpen });
              }}
              className="text-fg-3 hover:text-foreground flex items-center gap-1 text-[12px] transition"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
              />
              {t("mcp.advancedSettings")}
            </button>

            {advancedOpen && (
              <div className="border-border bg-sunken/30 mt-3 space-y-4 rounded-md border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-icon">{t("mcp.iconUrl")}</Label>
                  <Input
                    id="mcp-icon"
                    value={iconUrl}
                    onChange={(e) => {
                      setForm({ ...form, iconUrl: e.target.value });
                    }}
                    placeholder="https://logo.clearbit.com/example.com"
                  />
                  <p className="text-fg-3 text-[10px]">{t("mcp.leaveEmptyToUseInitial")}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="mcp-desc">{t("mcp.descriptionOptional")}</Label>
                  <Textarea
                    id="mcp-desc"
                    value={description}
                    onChange={(e) => {
                      setForm({ ...form, description: e.target.value });
                    }}
                    rows={2}
                    placeholder={t("mcp.descriptionPlaceholder")}
                  />
                </div>

                {authType === "oauth" && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-client-id">{t("mcp.oauthClientId")}</Label>
                      <Input
                        id="mcp-client-id"
                        value={oauthClientId}
                        onChange={(e) => {
                          setForm({ ...form, oauthClientId: e.target.value });
                        }}
                        placeholder={t("mcp.oauthClientIdPlaceholder")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-client-secret">{t("mcp.oauthClientSecret")}</Label>
                      <Input
                        id="mcp-client-secret"
                        type="password"
                        value={oauthClientSecret}
                        onChange={(e) => {
                          setForm({ ...form, oauthClientSecret: e.target.value });
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
            <div className="border-danger/30 bg-danger/5 text-danger w-full rounded-md border px-3 py-2 text-xs">
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
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            {submitting ? t("mcp.adding") : t("mcp.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
