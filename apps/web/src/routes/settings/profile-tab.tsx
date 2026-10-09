import { useRef, useState } from "react";

import { useAppSession } from "@/app/session/session-context";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Check, Loader2, Upload } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { uploadAccountAvatar } from "../../domains/file/api/account-avatar-client";
import { updateProfile } from "../../domains/user/api/user-client";
import { apiPath } from "../../platform/http/public-api";
import { getAvatarBackground, getAvatarInitial } from "../../shared/lib/avatar";
import { isTruthy } from "../../shared/lib/truthiness";
import { SettingsTabBody, SettingsTabHeader } from "./settings-tab-layout";

const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_URL_LENGTH = 2048;
const INTERNAL_FILE_PATH_PATTERN = new RegExp(
  `^${apiPath("/files")}/[A-Za-z0-9]+/content(?:\\?disposition=inline)?$`,
);

// Mirrors the server's avatar URL rule so the field can show a localized
// invalid state (contract section 4) before a save is attempted.
function isValidAvatarValue(value: string): boolean {
  if (value.length > MAX_AVATAR_URL_LENGTH) {
    return false;
  }

  if (INTERNAL_FILE_PATH_PATTERN.test(value)) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function ProfileTab() {
  const { t } = useTranslation();
  const { refreshOrganizations, user } = useAppSession();
  const [avatarInput, setAvatarInput] = useState(user?.image ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const trimmedAvatar = avatarInput.trim();
  const currentAvatar = user?.image ?? "";
  const dirty = trimmedName !== (user?.name ?? "") || trimmedAvatar !== currentAvatar;
  const avatarValid = trimmedAvatar === "" || isValidAvatarValue(trimmedAvatar);
  const canSave = dirty && trimmedName.length > 0 && avatarValid && !saving && !uploading;
  const avatarPreview = (avatarValid ? trimmedAvatar : "") || currentAvatar;
  const avatarBackground = getAvatarBackground(user?.email ?? user?.name);

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setError(null);
    setSaving(true);

    try {
      // The server normalizes the avatar URL; show what it stored.
      const profile = await updateProfile({
        imageUrl: trimmedAvatar === "" ? null : trimmedAvatar,
        name: trimmedName,
      });
      setName(profile.name);
      setAvatarInput(profile.imageUrl ?? "");
      await refreshOrganizations();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings.failedToSaveChanges"));
    } finally {
      setSaving(false);
    }
  }

  async function handleFileSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(t("settings.chooseImageFile"));
      return;
    }

    if (file.size > MAX_AVATAR_FILE_BYTES) {
      setError(t("settings.imageSizeLimit"));
      return;
    }

    setError(null);
    setUploading(true);

    try {
      setAvatarInput(await uploadAccountAvatar(user!.id, file));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings.uploadImageFailed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <SettingsTabHeader title={t("settings.profile")} />
      <SettingsTabBody>
        <div className="mb-8 flex items-center gap-5">
          {isTruthy(avatarPreview) ? (
            <img
              src={avatarPreview}
              alt={user?.name ?? ""}
              className="size-16 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="flex size-16 items-center justify-center rounded-full text-xl font-semibold text-white"
              style={{ background: avatarBackground }}
            >
              {getAvatarInitial(user?.name)}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-fg-heading tracking-subtitle truncate text-[16px] leading-5 font-semibold">
              {user?.name}
            </div>
            <div className="text-fg-3 truncate text-[13px]">{user?.email}</div>
            <div className="mt-2">
              <input
                ref={fileInputRef}
                aria-label={t("settings.uploadProfilePicture")}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    void handleFileSelected(file);
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={uploading || saving}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-1 size-4 animate-spin" /> {t("settings.uploading")}
                  </>
                ) : (
                  <>
                    <Upload className="mr-1 size-4" /> {t("settings.uploadImage")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-avatar-url">{t("settings.profilePictureUrl")}</Label>
          <p className="text-fg-3 text-[12px] leading-4">{t("settings.avatarHelp")}</p>
          <Input
            aria-label={t("settings.profilePictureUrl")}
            id="profile-avatar-url"
            type="text"
            inputMode="url"
            placeholder="https://example.com/avatar.png"
            aria-invalid={avatarValid ? undefined : true}
            value={avatarInput}
            onChange={(event) => {
              setAvatarInput(event.target.value);
            }}
          />
          {avatarValid ? null : (
            <p className="text-danger-fg text-[12px]" role="alert">
              {t("settings.invalidUrl")}
            </p>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="profile-display-name">{t("settings.displayName")}</Label>
          <Input
            aria-label={t("settings.displayName")}
            id="profile-display-name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="profile-email">{t("settings.email")}</Label>
          <Input
            aria-label={t("settings.email")}
            id="profile-email"
            type="email"
            value={user?.email ?? ""}
            readOnly
          />
        </div>

        {isTruthy(error) ? (
          <div
            className="border-danger/30 bg-danger-bg text-danger-fg mt-4 rounded-md border px-3 py-2 text-[13px]"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-6">
          <Button
            aria-busy={saving || undefined}
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 size-4 animate-spin" /> {t("settings.saving")}
              </>
            ) : saved ? (
              <>
                <Check className="mr-1 size-4" /> {t("settings.saved")}
              </>
            ) : (
              t("settings.saveChanges")
            )}
          </Button>
        </div>
      </SettingsTabBody>
    </div>
  );
}
