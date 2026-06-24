import { Check, Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

import { useAppSession } from "../../app/session-provider";
import { uploadAccountAvatar } from "../../domains/file/api/account-avatar-client";
import { updateProfile } from "../../domains/user/api/user-client";
import { apiPath } from "../../platform/http/public-api";
import { getAvatarBackground, getAvatarInitial } from "../../shared/lib/avatar";
import { isTruthy } from "../../shared/lib/truthiness";
import { toAccountId } from "../typed-id";

const MAX_AVATAR_URL_LENGTH = 2048;
const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;
const INTERNAL_FILE_PATH_PATTERN = new RegExp(
  `^${apiPath("/files")}/[A-Za-z0-9]+/content(?:\\?disposition=inline)?$`,
);

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

export function ProfileTab() {
  const { refreshOrganizations, user } = useAppSession();
  const [name, setName] = useState(user?.name ?? "");
  const [avatarInput, setAvatarInput] = useState(user?.image ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  useEffect(() => {
    setAvatarInput(user?.image ?? "");
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
  const avatarPreviewValid = avatarPreview === "" || isValidAvatarValue(avatarPreview);
  const canSave = dirty && nameValid && avatarValid && !saving && !uploading;
  const avatarBackground = getAvatarBackground(user?.email ?? user?.name);

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateProfile({
        imageUrl: trimmedAvatar === "" ? null : trimmedAvatar,
        name: trimmedName,
      });
      await refreshOrganizations();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileSelected(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    if (file.size > MAX_AVATAR_FILE_BYTES) {
      setError("Image must be 5 MB or smaller.");
      return;
    }

    if (!isTruthy(user?.id)) {
      setError("Unable to upload right now. Please try again.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const imageUrl = await uploadAccountAvatar(toAccountId(user.id), file);
      setAvatarInput(imageUrl);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload image.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">Profile</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] p-6">
          <div className="mb-8 flex items-center gap-5">
            {isTruthy(avatarPreview) && avatarPreviewValid ? (
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
              <div className="text-foreground truncate text-lg font-semibold">{user?.name}</div>
              <div className="text-muted-foreground truncate text-sm">{user?.email}</div>
              <div className="mt-2">
                <input
                  ref={fileInputRef}
                  aria-label="Upload profile picture"
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
                      <Loader2 className="mr-1 size-4 animate-spin" /> Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="mr-1 size-4" /> Upload image
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-foreground text-sm font-medium" htmlFor="profile-avatar-url">
              Profile picture URL
            </label>
            <p className="text-fg-2 text-[12px]">
              Upload an image above, or paste an image URL to use as your avatar.
            </p>
            <input
              aria-label="Profile picture URL"
              id="profile-avatar-url"
              type="text"
              inputMode="url"
              placeholder="https://example.com/avatar.png"
              value={avatarInput}
              onChange={(event) => {
                setAvatarInput(event.target.value);
              }}
              className="border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none"
            />
            {trimmedAvatar !== "" && !avatarValid ? (
              <p className="text-destructive text-[12px]">Enter a valid http or https URL.</p>
            ) : null}
          </div>

          <div className="mt-4 space-y-2">
            <label className="text-foreground text-sm font-medium" htmlFor="profile-display-name">
              Display name
            </label>
            <input
              aria-label="Display name"
              id="profile-display-name"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none"
            />
          </div>

          <div className="mt-4 space-y-2">
            <label className="text-foreground text-sm font-medium" htmlFor="profile-email">
              Email
            </label>
            <input
              aria-label="Email"
              id="profile-email"
              type="email"
              value={user?.email ?? ""}
              readOnly
              className="border-border bg-muted text-muted-foreground h-10 w-full cursor-not-allowed rounded-lg border px-3 text-sm"
            />
          </div>

          {isTruthy(error) ? (
            <div className="bg-destructive/10 text-destructive mt-4 rounded-lg p-3 text-sm">
              {error}
            </div>
          ) : null}

          <div className="mt-6">
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
          </div>
        </div>
      </div>
    </>
  );
}
