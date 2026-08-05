import { Star } from "lucide-react";

import { useTranslation } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";

export function EnvironmentBadges({
  environment,
}: {
  environment: {
    isBuiltIn: boolean;
    isDefault: boolean;
    networkPolicy: "full" | "limited";
    role: "owner";
  };
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-1.5">
      {environment.isBuiltIn ? <Badge variant="primary">{t("environments.builtIn")}</Badge> : null}
      {environment.isDefault ? (
        <Badge className="gap-1" variant="warning">
          <Star className="size-3" />
          {t("environments.default")}
        </Badge>
      ) : null}
      <Badge variant={environment.networkPolicy === "limited" ? "soil" : "default"}>
        {environment.networkPolicy === "limited"
          ? t("environments.limitedNetwork")
          : t("environments.fullNetwork")}
      </Badge>
    </div>
  );
}
