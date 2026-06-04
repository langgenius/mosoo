import { Globe } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import type { AvatarUser } from "./access-model";
import { ShareUserAvatar } from "./share-user-avatar";

interface BaseAccessRowProps {
  badge?: string | undefined;
  children: ReactNode;
  meta?: string | undefined;
  subtitle?: string | null;
  title: string;
}

type AccessRowProps =
  | (BaseAccessRowProps & {
      avatarUser: AvatarUser;
      organizationIcon?: false;
    })
  | (BaseAccessRowProps & {
      avatarUser?: never;
      organizationIcon: true;
    });

function renderOrganizationAvatar(): ReactElement {
  return (
    <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
      <Globe className="text-muted-foreground size-4" />
    </div>
  );
}

export function AccessRow(props: AccessRowProps): ReactElement {
  const { badge, children, meta, subtitle, title } = props;
  const icon =
    props.organizationIcon === true ? (
      renderOrganizationAvatar()
    ) : (
      <ShareUserAvatar user={props.avatarUser} />
    );

  return (
    <div className="hover:bg-accent/30 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-foreground truncate text-sm font-medium">{title}</span>
            {badge ? (
              <span className="bg-amber-bg text-amber-fg rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                {badge}
              </span>
            ) : null}
            {meta ? <span className="text-muted-foreground text-[10px]">{meta}</span> : null}
          </div>
          {subtitle ? (
            <div className="text-muted-foreground truncate text-xs">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
