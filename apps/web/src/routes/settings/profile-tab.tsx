import { useEffect, useReducer, useRef } from "react";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Check, Loader2, Upload } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { useAppSession } from "../../app/session-provider";
import { uploadAccountAvatar } from "../../domains/file/api/account-avatar-client";
import { updateProfile } from "../../domains/user/api/user-client";
import { apiPath } from "../../platform/http/public-api";
import { getAvatarBackground, getAvatarInitial } from "../../shared/lib/avatar";
import { isTruthy } from "../../shared/lib/truthiness";
import { toAccountId } from "../typed-id";
import { SettingsTabBody, SettingsTabHeader } from "./settings-tab-layout";

const MAX_AVATAR_URL_LENGTH = 2048;
const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;
const INTERNAL_FILE_PATH_PATTERN = new RegExp(
  `^${apiPath("/files")}/[A-Za-z0-9]+/content(?:\\?disposition=inline)?$`,
);

interface ProfileFormState {
  avatarInput: string;
  error: string | null;
  name: string;
  saved: boolean;
  saving: boolean;
  uploading: boolean;
}

type ProfileFormAction =
  | { type: "changeAvatar"; avatarInput: string }
  | { type: "changeName"; name: string }
  | { type: "clearSaved" }
  | { type: "saveError"; error: string }
  | { type: "saveStart" }
  | { type: "saveSuccess" }
  | { type: "setError"; error: string }
  | { type: "syncAvatar"; avatarInput: string }
  | { type: "syncName"; name: string }
  | { type: "uploadError"; error: string }
  | { type: "uploadStart" }
  | { type: "uploadSuccess"; avatarInput: string };

function profileFormReducer(state: ProfileFormState, action: ProfileFormAction): ProfileFormState {
  switch (action.type) {
    case "changeAvatar":
      return { ...state, avatarInput: action.avatarInput };
    case "changeName":
      return { ...state, name: action.name };
    case "clearSaved":
      return { ...state, saved: false };
    case "saveError":
      return { ...state, error: action.error, saving: false };
    case "saveStart":
      return { ...state, error: null, saving: true };
    case "saveSuccess":
      return { ...state, saved: true, saving: false };
    case "setError":
      return { ...state, error: action.error };
    case "syncAvatar":
      return { ...state, avatarInput: action.avatarInput };
    case "syncName":
      return { ...state, name: action.name };
    case "uploadError":
      return { ...state, error: action.error, uploading: false };
    case "uploadStart":
      return { ...state, error: null, uploading: true };
    case "uploadSuccess":
      return { ...state, avatarInput: action.avatarInput, uploading: false };
  }
}

function isValidAvatarValue(value: string): boolean {
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

// Only an http(s) URL or an internal file path may ever reach an <img src>.
// Routing the value through this guard (rather than a separately computed
// boolean) keeps the validation on the exact value that flows to the sink.
function sanitizeAvatarSrc(value: string): string {
  return isValidAvatarValue(value) ? value : "";
}

export function ProfileTab() {
  const { t } = useTranslation();
  const { refreshOrganizations, user } = useAppSession();
  const [state, dispatch] = useReducer(profileFormReducer, {
    avatarInput: user?.image ?? "",
    error: null,
    name: user?.name ?? "",
    saved: false,
    saving: false,
    uploading: false,
  });
  const { avatarInput, error, name, saved, saving, uploading } = state;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dispatch({ name: user?.name ?? "", type: "syncName" });
  }, [user?.name]);

  useEffect(() => {
    dispatch({ avatarInput: user?.image ?? "", type: "syncAvatar" });
  }, [user?.image]);

  const trimmedName = name.trim();
  const trimmedAvatar = avatarInput.trim();
  const currentAvatar = user?.image ?? "";
  const nameChanged = trimmedName !== (user?.name ?? "");
  const avatarChanged = trimmedAvatar !== currentAvatar;
  const dirty = nameChanged || avatarChanged;
  const nameValid = trimmedName.length > 0;
  const avatarValid =
    trimmedAvatar === "" ||
    (trimmedAvatar.length <= MAX_AVATAR_URL_LENGTH && isValidAvatarValue(trimmedAvatar));
  const avatarPreview = trimmedAvatar || currentAvatar;
  const avatarPreviewSrc = sanitizeAvatarSrc(avatarPreview);
  const canSave = dirty && nameValid && avatarValid && !saving && !uploading;
  const avatarBackground = getAvatarBackground(user?.email ?? user?.name);

  async function handleSave() {
    if (!canSave) {
      return;
    }

    dispatch({ type: "saveStart" });

    try {
      await updateProfile({
        imageUrl: trimmedAvatar === "" ? null : trimmedAvatar,
        name: trimmedName,
      });
      await refreshOrganizations();
      dispatch({ type: "saveSuccess" });
      setTimeout(() => {
        dispatch({ type: "clearSaved" });
      }, 2000);
    } catch (nextError) {
      dispatch({
        error: nextError instanceof Error ? nextError.message : t("settings.failedToSaveChanges"),
        type: "saveError",
      });
    }
  }

  async function handleFileSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      dispatch({ error: t("settings.chooseImageFile"), type: "setError" });
      return;
    }

    if (file.size > MAX_AVATAR_FILE_BYTES) {
      dispatch({ error: t("settings.imageSizeLimit"), type: "setError" });
      return;
    }

    if (!isTruthy(user?.id)) {
      dispatch({ error: t("settings.uploadUnavailable"), type: "setError" });
      return;
    }

    dispatch({ type: "uploadStart" });

    try {
      const imageUrl = await uploadAccountAvatar(toAccountId(user.id), file);
      dispatch({ avatarInput: imageUrl, type: "uploadSuccess" });
    } catch (nextError) {
      dispatch({
        error: nextError instanceof Error ? nextError.message : t("settings.uploadImageFailed"),
        type: "uploadError",
      });
    }
  }

  return (
    <>
      <SettingsTabHeader title={t("settings.profile")} />
      <SettingsTabBody>
        <div className="mb-8 flex items-center gap-5">
          {isTruthy(avatarPreviewSrc) ? (
            <img
              src={avatarPreviewSrc}
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
            <div className="text-fg-heading truncate text-[16px] font-semibold">{user?.name}</div>
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
            value={avatarInput}
            onChange={(event) => {
              dispatch({ avatarInput: event.target.value, type: "changeAvatar" });
            }}
          />
          {trimmedAvatar !== "" && !avatarValid ? (
            <p className="text-danger-fg text-[12px]" role="alert">
              {t("settings.invalidUrl")}
            </p>
          ) : null}
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="profile-display-name">{t("settings.displayName")}</Label>
          <Input
            aria-label={t("settings.displayName")}
            id="profile-display-name"
            type="text"
            value={name}
            onChange={(event) => {
              dispatch({ name: event.target.value, type: "changeName" });
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
    </>
  );
}
