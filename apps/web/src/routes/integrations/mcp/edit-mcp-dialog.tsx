import type { McpServerWithCredential } from "@mosoo/contracts/mcp";
import { useState } from "react";

import { useTranslation } from "@/shared/i18n";
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

export function EditMcpDialog({ server, onOpenChange, onSubmit }: Props) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(server.description ?? "");
  const [iconUrl, setIconUrl] = useState(server.iconUrl ?? "");
  const [name, setName] = useState(server.name);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState(server.url);

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
    setSubmitError(null);
    setSubmitting(true);

    try {
      await onSubmit({
        description: trimmedDesc.length > 0 ? trimmedDesc : null,
        iconUrl: trimmedIcon.length > 0 ? trimmedIcon : null,
        name: name.trim(),
        url: url.trim(),
      });
      onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("mcp.failedToUpdate"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("mcp.editConnection")}</DialogTitle>
          <DialogDescription>
            {t("mcp.editDescription", { authType: authTypeLabel(server.authType, t) })}
          </DialogDescription>
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
              <Label htmlFor="mcp-edit-name">{t("mcp.name")}</Label>
              <Input
                id="mcp-edit-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
                placeholder={t("mcp.namePlaceholder")}
              />
            </div>
          </div>

          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-edit-url">{t("mcp.serverUrl")}</Label>
            <Input
              id="mcp-edit-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
              }}
              placeholder="https://mcp.figma.com/mcp"
            />
            {url.length > 0 && !urlValid && (
              <p className="text-danger text-[11px]">{t("mcp.urlMustStartWithHttps")}</p>
            )}
            {disconnectsOnSave && (
              <p className="text-warning-fg text-[11px]">{t("mcp.urlChangeDisconnects")}</p>
            )}
          </div>

          {/* Icon URL */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-edit-icon">{t("mcp.iconUrl")}</Label>
            <Input
              id="mcp-edit-icon"
              value={iconUrl}
              onChange={(e) => {
                setIconUrl(e.target.value);
              }}
              placeholder="https://logo.clearbit.com/example.com"
            />
            <p className="text-fg-3 text-[10px]">{t("mcp.leaveEmptyToUseInitial")}</p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="mcp-edit-desc">{t("mcp.descriptionOptional")}</Label>
            <Textarea
              id="mcp-edit-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={2}
              placeholder={t("mcp.descriptionPlaceholder")}
            />
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
              onOpenChange(false);
            }}
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
            {submitting ? t("mcp.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
