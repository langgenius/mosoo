import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/shared/ui/button";

import { useAppSession } from "../../app/session-provider";
import { updateProfile } from "../../domains/user/api/user-client";
import { isTruthy } from "../../shared/lib/truthiness";
export function ProfileTab() {
  const { user } = useAppSession();
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isTruthy(user?.name)) {
      setName(user.name);
    }
  }, [user?.name]);

  async function handleSave() {
    if (!name.trim() || name.trim() === user?.name) {
      return;
    }

    setSaving(true);

    try {
      await updateProfile(name.trim());
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2000);
    } finally {
      setSaving(false);
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
            {isTruthy(user?.image) ? (
              <img
                src={user.image}
                alt={user.name}
                className="size-16 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="flex size-16 items-center justify-center rounded-full text-xl font-semibold text-white"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.08)), rgb(21, 90, 239)",
                }}
              >
                {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-foreground truncate text-lg font-semibold">{user?.name}</div>
              <div className="text-muted-foreground truncate text-sm">{user?.email}</div>
            </div>
          </div>

          <div className="space-y-2">
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

          <div className="mt-6">
            <Button
              onClick={() => void handleSave()}
              disabled={saving || !name.trim() || name.trim() === user?.name}
              size="sm"
            >
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
