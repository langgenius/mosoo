import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session/session-context";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Loader2 } from "@/shared/ui/icons";

import { captureProductEvent, PRODUCT_ANALYTICS_EVENTS } from "../../analytics/product-analytics";
import { onboardingBootstrap } from "../../domains/onboarding/api/onboarding-client";

export function Onboarding() {
  const { refreshOrganizations } = useAppSession();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setError(null);
    captureProductEvent(PRODUCT_ANALYTICS_EVENTS.onboardingStarted);
    try {
      await onboardingBootstrap();
      await refreshOrganizations();
      void navigate("/", { replace: true });
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : "");
    }
  }, [navigate, refreshOrganizations]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (error === null) {
    return (
      <div className="bg-background fixed inset-0 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="text-brand-mark size-8 animate-spin" />
          <p className="text-fg-3 text-sm">{t("onboarding.creatingDefaultProject")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      <div className="flex items-center px-4 py-5 sm:px-8">
        <img src="/brand/logo-wordmark-onlight.svg" alt="mosoo" className="block h-5" />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[520px] px-6 text-center">
          <h2 className="t-page-title">{t("onboarding.setupFailed")}</h2>
          <p className="text-fg-3 mt-2 text-sm">{error || t("common.somethingWentWrong")}</p>

          <Button className="mt-6" onClick={() => void bootstrap()} variant="outline">
            {t("agent.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}
