import { Check, Loader2, Upload } from "lucide-react";
import { useMemo, useReducer, useRef } from "react";
import type { ChangeEvent } from "react";
import { Navigate } from "react-router-dom";

import { Button } from "@/shared/ui/button";

import { useAppSession } from "../../app/session-provider";
import { uploadOrganizationAvatar } from "../../domains/file/api/organization-avatar-file-client";
import { updateOrganizationProfile } from "../../domains/organization/api/organization-catalog-client";
import { isTruthy } from "../../shared/lib/truthiness";
import { toOrganizationId } from "../typed-id";

const MAX_NAME_LENGTH = 80;
const MAX_AVATAR_URL_LENGTH = 2048;
const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";

interface OrganizationGeneralFormState {
  avatarInput: string;
  error: string | null;
  name: string;
  saved: boolean;
  saving: boolean;
  uploading: boolean;
}

type OrganizationGeneralFormAction =
  | { type: "avatarUploaded"; url: string }
  | { type: "changeAvatarInput"; value: string }
  | { type: "changeName"; value: string }
  | { type: "reset"; avatarInput: string; name: string }
  | { type: "setError"; error: string | null }
  | { type: "setSaved"; saved: boolean }
  | { type: "setSaving"; saving: boolean }
  | { type: "setUploading"; uploading: boolean };

function createOrganizationGeneralFormState({
  avatarUrl,
  organizationName,
}: {
  avatarUrl: string | null;
  organizationName: string;
}): OrganizationGeneralFormState {
  return {
    avatarInput: avatarUrl ?? "",
    error: null,
    name: organizationName,
    saved: false,
    saving: false,
    uploading: false,
  };
}

function organizationGeneralFormReducer(
  state: OrganizationGeneralFormState,
  action: OrganizationGeneralFormAction,
): OrganizationGeneralFormState {
  switch (action.type) {
    case "avatarUploaded":
      return { ...state, avatarInput: action.url };
    case "changeAvatarInput":
      return { ...state, avatarInput: action.value };
    case "changeName":
      return { ...state, name: action.value };
    case "reset":
      return { ...state, avatarInput: action.avatarInput, error: null, name: action.name };
    case "setError":
      return { ...state, error: action.error };
    case "setSaved":
      return { ...state, saved: action.saved };
    case "setSaving":
      return { ...state, saving: action.saving };
    case "setUploading":
      return { ...state, uploading: action.uploading };
  }
}

function normalizeForCompare(value: string | null): string {
  return value?.trim() ?? "";
}

function getOrganizationInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function isValidAvatarUrl(value: string): boolean {
  if (value.startsWith("/")) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function OrganizationGeneralTab() {
  const { activeOrganization, organizationsLoading, refreshOrganizations } = useAppSession();

  if (!activeOrganization) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization…" : "No organization available."}
      </div>
    );
  }

  if (activeOrganization.viewerRole !== "owner") {
    return <Navigate to="/settings/members" replace />;
  }

  return (
    <OrganizationGeneralForm
      key={`${activeOrganization.id}:${activeOrganization.name}:${activeOrganization.avatarUrl ?? ""}`}
      organizationId={activeOrganization.id}
      organizationName={activeOrganization.name}
      organizationSlug={activeOrganization.slug}
      avatarUrl={activeOrganization.avatarUrl}
      onSaved={refreshOrganizations}
    />
  );
}

function OrganizationGeneralForm({
  avatarUrl,
  onSaved,
  organizationId,
  organizationName,
  organizationSlug,
}: {
  avatarUrl: string | null;
  onSaved: () => Promise<unknown>;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
}) {
  const [state, dispatch] = useReducer(
    organizationGeneralFormReducer,
    { avatarUrl, organizationName },
    createOrganizationGeneralFormState,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { avatarInput, error, name, saved, saving, uploading } = state;

  const trimmedName = name.trim();
  const trimmedAvatar = avatarInput.trim();
  const nameChanged = trimmedName !== organizationName;
  const avatarChanged = trimmedAvatar !== normalizeForCompare(avatarUrl);
  const avatarPreview = trimmedAvatar || (avatarUrl ?? "");
  const avatarPreviewValid = avatarPreview === "" || isValidAvatarUrl(avatarPreview);
  const dirty = nameChanged || avatarChanged;
  const nameValid = trimmedName.length > 0 && trimmedName.length <= MAX_NAME_LENGTH;
  const avatarValid =
    trimmedAvatar.length <= MAX_AVATAR_URL_LENGTH &&
    (trimmedAvatar === "" || isValidAvatarUrl(trimmedAvatar));
  const canSave = dirty && nameValid && avatarValid && !saving;

  const initial = useMemo(
    () => getOrganizationInitial(name || organizationName),
    [name, organizationName],
  );

  async function handleSave() {
    if (!canSave) {
      return;
    }

    dispatch({ saving: true, type: "setSaving" });
    dispatch({ error: null, type: "setError" });

    const input: Parameters<typeof updateOrganizationProfile>[0] = {
      organizationId: toOrganizationId(organizationId),
    };

    if (nameChanged) {
      input.name = trimmedName;
    }

    if (avatarChanged) {
      input.avatarUrl = trimmedAvatar === "" ? null : trimmedAvatar;
    }

    try {
      await updateOrganizationProfile(input);

      await onSaved();
      dispatch({ saved: true, type: "setSaved" });
      setTimeout(() => {
        dispatch({ saved: false, type: "setSaved" });
      }, 2000);
    } catch (nextError) {
      dispatch({
        error: nextError instanceof Error ? nextError.message : "Failed to save changes.",
        type: "setError",
      });
    } finally {
      dispatch({ saving: false, type: "setSaving" });
    }
  }

  function handleReset() {
    dispatch({ avatarInput: avatarUrl ?? "", name: organizationName, type: "reset" });
  }

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      dispatch({ error: "Logo must be an image file.", type: "setError" });
      return;
    }

    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      dispatch({ error: "Logo must be 5 MB or smaller.", type: "setError" });
      return;
    }

    dispatch({ type: "setUploading", uploading: true });
    dispatch({ error: null, type: "setError" });

    try {
      const { url } = await uploadOrganizationAvatar(toOrganizationId(organizationId), file);
      dispatch({ type: "avatarUploaded", url });
    } catch (nextError) {
      dispatch({
        error: nextError instanceof Error ? nextError.message : "Failed to upload logo.",
        type: "setError",
      });
    } finally {
      dispatch({ type: "setUploading", uploading: false });
    }
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">General</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-6 py-8">
          <h1 className="text-fg-1 text-[20px] font-semibold tracking-[-0.01em]">
            Organization profile
          </h1>
          <p className="text-fg-2 mt-1 text-[13px] leading-5">
            Update how this organization appears to members. Only the owner can edit these settings.
          </p>

          <div className="border-border-soft mt-6 rounded-xl border bg-white/40 p-5">
            <div className="space-y-2">
              <label className="text-foreground text-sm font-medium" htmlFor="org-avatar-url">
                Logo
              </label>
              <p className="text-fg-2 text-[12px]">
                Upload an image (PNG, JPG, WEBP, GIF, SVG, up to 5 MB) or paste an image URL. Used
                as the organization avatar across Mosoo.
              </p>
              <div className="flex items-center gap-4 pt-1">
                {isTruthy(avatarPreview) && avatarPreviewValid ? (
                  <img
                    src={avatarPreview}
                    alt={organizationName}
                    className="border-border-soft size-16 rounded-xl border object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="border-border-soft bg-green-600 flex size-16 items-center justify-center rounded-xl border text-xl font-semibold text-white">
                    {initial}
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="Organization avatar URL"
                      id="org-avatar-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/logo.png"
                      value={avatarInput}
                      onChange={(event) => {
                        dispatch({ type: "changeAvatarInput", value: event.target.value });
                      }}
                      className="border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Uploading…
                        </>
                      ) : (
                        <>
                          <Upload className="size-4" /> Upload
                        </>
                      )}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={AVATAR_FILE_ACCEPT}
                      aria-label="Upload organization logo"
                      className="hidden"
                      onChange={(event) => {
                        void handleAvatarFileChange(event);
                      }}
                    />
                  </div>
                  {trimmedAvatar !== "" && !avatarValid ? (
                    <p className="text-destructive text-[12px]">Enter a valid http or https URL.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="border-border-soft mt-6 border-t pt-5">
              <div className="space-y-2">
                <label className="text-foreground text-sm font-medium" htmlFor="org-display-name">
                  Organization name
                </label>
                <input
                  aria-label="Organization name"
                  id="org-display-name"
                  type="text"
                  value={name}
                  maxLength={MAX_NAME_LENGTH}
                  onChange={(event) => {
                    dispatch({ type: "changeName", value: event.target.value });
                  }}
                  className="border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none"
                />
                {!nameValid && trimmedName.length === 0 ? (
                  <p className="text-destructive text-[12px]">Organization name is required.</p>
                ) : null}
              </div>
            </div>

            <div className="border-border-soft mt-6 border-t pt-5">
              <div className="space-y-2">
                <label className="text-foreground text-sm font-medium" htmlFor="org-slug">
                  Organization URL
                </label>
                <div className="border-border bg-muted text-muted-foreground flex h-10 items-center rounded-lg border px-3 text-sm">
                  <span className="text-fg-2 mr-1">mosoo.app/</span>
                  <span id="org-slug" className="text-foreground font-medium">
                    {organizationSlug}
                  </span>
                </div>
                <p className="text-fg-2 text-[12px]">
                  URL slug is generated when the organization is created.
                </p>
              </div>
            </div>
          </div>

          {isTruthy(error) ? (
            <div className="bg-destructive/10 text-destructive mt-4 rounded-lg p-3 text-sm">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex items-center gap-2">
            <Button onClick={() => void handleSave()} disabled={!canSave} size="sm">
              {saving ? (
                <>
                  <Loader2 className="mr-1 size-4 animate-spin" /> Saving…
                </>
              ) : saved ? (
                <>
                  <Check className="mr-1 size-4" /> Saved
                </>
              ) : (
                "Save changes"
              )}
            </Button>
            {dirty && !saving ? (
              <Button onClick={handleReset} variant="ghost" size="sm">
                Discard
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
