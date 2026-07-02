import { CircleAlert } from "lucide-react";

import { Layout } from "@/app/app-shell";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { AppOverviewInstallGuide } from "../app-overview-install";
import { DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import { DeploySurface } from "./deploy-surface";
import { useDeployConsole } from "./use-deploy-console";

/**
 * Unauthenticated acceptance entry for the Overview deploy surface.
 *
 * Renders the SAME `DeploySurface` composition as the live App Overview ("/")
 * inside the real App-layer chrome but outside the auth guard, backed by the
 * in-memory fixture so it reviews on the web dev server alone (no API, login,
 * or seeded data). The simulated run machine walks empty → deploying → live;
 * the demo control in the header showcases the failed state.
 */
export function V0DeployPreviewPage() {
  const demo = useDeployConsole();
  const { deployment } = demo.state;

  return (
    <Layout>
      <DeploySurface
        appId={DEPLOY_APP_IDENTITY.appId}
        appName={DEPLOY_APP_IDENTITY.appName}
        deploy={demo}
        deployError={null}
        emptyHero={<AppOverviewInstallGuide />}
        headerBadges={<Badge variant="soil">Demo data</Badge>}
        headerActions={
          deployment === null || demo.deploying ? null : (
            <Button variant="outline" size="sm" onClick={demo.failDeploy}>
              <CircleAlert className="size-3.5" />
              Simulate failed deploy
            </Button>
          )
        }
      />
    </Layout>
  );
}
