import { ChevronsUpDown, LayoutGrid, LogOut, Settings } from "lucide-react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import { authClient } from "../domains/auth/api/auth-client";
import { getAvatarBackground, getAvatarInitial } from "../shared/lib/avatar";
import { isTruthy } from "../shared/lib/truthiness";
interface AccountMenuUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
}

function UserAvatar({
  size = 28,
  user,
}: {
  size?: number;
  user: { email?: string | null; image?: string | null; name: string } | null;
}) {
  if (isTruthy(user?.image)) {
    return (
      <img
        src={user.image}
        alt={user.name}
        className="shrink-0 rounded-full object-cover"
        style={{ height: size, width: size }}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold tracking-[0.02em] text-white"
      style={{
        background: getAvatarBackground(user?.email ?? user?.name),
        fontSize: size * 0.4,
        height: size,
        width: size,
      }}
    >
      {getAvatarInitial(user?.name)}
    </div>
  );
}

export function AccountMenu({
  collapsed,
  user,
}: {
  collapsed: boolean;
  user: AccountMenuUser | null;
}) {
  const wrapperClassName = cn(collapsed ? "flex justify-center pb-3 pt-2" : "px-2 pb-3 pt-2");
  const trigger = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          aria-label={user?.name ?? "Account"}
          className="hover:bg-ink-900/[0.04] size-9 justify-center self-center rounded-full p-0"
        >
          <UserAvatar size={28} user={user} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{user?.name ?? "Account"}</TooltipContent>
    </Tooltip>
  ) : (
    <Button
      variant="ghost"
      className="hover:bg-ink-900/[0.04] flex h-auto w-full items-center justify-start gap-2.5 rounded-lg p-2 text-left"
    >
      <UserAvatar user={user} />
      <div className="min-w-0 flex-1">
        <div className="text-fg-1 truncate text-[13px] font-bold">{user?.name}</div>
        <div className="text-fg-3 truncate text-[11.5px]">{user?.email}</div>
      </div>
      <ChevronsUpDown className="text-fg-3 size-3.5 shrink-0" />
    </Button>
  );

  return (
    <div className={wrapperClassName}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-[220px] rounded-lg p-1">
          <DropdownMenuLabel className="px-2 pb-1">
            <div className="text-fg-1 text-[13px] font-semibold">{user?.name}</div>
            <div className="text-fg-3 mt-0.5 text-[11.5px] font-normal">{user?.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer rounded-md">
            <Link to="/apps">
              <LayoutGrid className="size-4" />
              Apps
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer rounded-md">
            <Link to="/settings">
              <Settings className="size-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer rounded-md"
            onSelect={() => {
              void (async () => {
                await authClient["signOut"]();
                globalThis.location.href = "/login";
              })();
            }}
          >
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
