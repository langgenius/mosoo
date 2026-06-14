import { Star } from "lucide-react";

import { Badge } from "@/shared/ui/badge";

export function EnvironmentBadges({
  environment,
}: {
  environment: {
    isBuiltIn: boolean;
    isDefault: boolean;
    networkPolicy: "full" | "limited";
    role: "owner" | "user";
  };
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {environment.isBuiltIn ? <Badge variant="primary">BUILT-IN</Badge> : null}
      {environment.isDefault ? (
        <Badge className="gap-1" variant="warning">
          <Star className="size-3" />
          Default
        </Badge>
      ) : null}
      <Badge variant={environment.networkPolicy === "limited" ? "soil" : "default"}>
        {environment.networkPolicy === "limited" ? "Limited" : "Full"}
      </Badge>
    </div>
  );
}
