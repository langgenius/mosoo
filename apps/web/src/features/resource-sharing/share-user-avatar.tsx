import type { ReactElement } from "react";

import { AvatarFallback } from "@/shared/ui/avatar-fallback";
import { AvatarImage } from "@/shared/ui/avatar-image";
import { Avatar } from "@/shared/ui/avatar-root";

import { getAvatarUrl } from "./access-model";
import type { AvatarUser } from "./access-model";

export function ShareUserAvatar({ size, user }: { size?: "sm"; user: AvatarUser }): ReactElement {
  const imageUrl = getAvatarUrl(user);
  const name = user.name ?? "?";
  const hasImageUrl = imageUrl !== null && imageUrl.length > 0;

  return (
    <Avatar {...(size === undefined ? {} : { size })}>
      {hasImageUrl ? <AvatarImage src={imageUrl} alt={name} referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-primary/10 text-primary font-medium">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
