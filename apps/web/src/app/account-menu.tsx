import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon";
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { resetProductAnalytics } from "@/analytics/product-analytics";
import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SidebarTooltip } from "@/shared/ui/sidebar";

import { authClient } from "../domains/auth/api/auth-client";
import { getAvatarBackground, getAvatarInitial } from "../shared/lib/avatar";
import { isTruthy } from "../shared/lib/truthiness";
import { createHugeicon } from "./hugeicon";

const AccountMenuChevronIcon = createHugeicon(ChevronDownIcon, "AccountMenuChevronIcon");
const AccountMenuSettingsIcon = createHugeicon(Settings02Icon, "AccountMenuSettingsIcon");
const AccountMenuSignOutIcon = createHugeicon(Logout01Icon, "AccountMenuSignOutIcon");

interface AccountMenuUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
}

function UserAvatar({
  size = 26,
  user,
}: {
  size?: number;
  user: { email?: string | null; image?: string | null; name: string } | null;
}): ReactElement {
  if (isTruthy(user?.image)) {
    return (
      <img
        src={user.image}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ height: size, width: size }}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-bold tracking-[0.02em] text-white"
      style={{
        background: getAvatarBackground(user?.email ?? user?.name),
        fontSize: size * 0.4,
        height: size,
        width: size,
      }}
    >
      {getAvatarInitial(user?.name)}
    </span>
  );
}

// Anchored account card at the foot of the sidebar: the bordered card from the
// sidebar references (avatar, name, email, chevron on the far edge), the
// counterpart of the identity row at the head. It is the one bordered surface
// in the sidebar, which is what anchors the persistent zone without a rule.
// The card already shows the name and email, so the upward menu lists only
// Account settings and Sign out.
export function AccountMenu({
  collapsed,
  user,
}: {
  collapsed: boolean;
  user: AccountMenuUser | null;
}): ReactElement {
  const { t } = useTranslation();
  const name = user?.name ?? t("nav.account");

  const trigger = (
    <button
      type="button"
      aria-label={collapsed ? name : undefined}
      data-slot="account-card"
      className={cn(
        "focus-visible:ring-ring focus-visible:ring-offset-sidebar flex shrink-0 items-center text-left outline-none transition-[background-color,border-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-offset-1",
        collapsed
          ? "hover:bg-sidebar-row-hover data-[popup-open]:bg-sidebar-row-active mx-auto size-8 justify-center rounded-md"
          : "border-border bg-card hover:border-border-strong data-[popup-open]:border-border-strong h-[52px] w-full gap-2.5 rounded-md border pr-2.5 pl-2.5",
      )}
    >
      <UserAvatar size={collapsed ? 24 : 30} user={user} />
      {collapsed ? null : (
        <>
          <span className="sidebar-label-enter min-w-0 flex-1">
            <span className="text-fg-1 block truncate text-[13px] leading-4 font-semibold">
              {name}
            </span>
            <span className="text-fg-3 block truncate text-[12px] leading-4">{user?.email}</span>
          </span>
          <AccountMenuChevronIcon className="sidebar-label-enter text-fg-3 size-3.5 shrink-0" />
        </>
      )}
    </button>
  );

  return (
    <div className={cn("flex flex-col pt-2 pb-3", collapsed ? "items-center" : "")}>
      <DropdownMenu>
        <SidebarTooltip collapsed={collapsed} label={name}>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </SidebarTooltip>

        <DropdownMenuContent
          align="start"
          side={collapsed ? "right" : "top"}
          sideOffset={8}
          className="w-[216px]"
        >
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link to="/settings">
              <AccountMenuSettingsIcon className="size-4" />
              {t("nav.accountSettings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => {
              void (async () => {
                await authClient["signOut"]();
                resetProductAnalytics();
                globalThis.location.href = "/login";
              })();
            }}
          >
            <AccountMenuSignOutIcon className="size-4" />
            {t("common.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
