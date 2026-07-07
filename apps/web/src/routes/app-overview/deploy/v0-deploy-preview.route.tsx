import { CircleAlert } from "lucide-react";
import { useState } from "react";

import { Layout } from "@/app/app-shell";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { AppOverviewInstallGuide } from "../app-overview-install";
import { DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import type { DeployConsoleScenario } from "./deploy-console-data";
import { DeploySurface } from "./deploy-surface";
import { useDeployConsole } from "./use-deploy-console";

/** All four exposure states of the deploy surface, in review order. */
const SCENARIOS: DeployConsoleScenario[] = ["web", "agent-only", "web-and-agents", "native-red"];

/**
 * Unauthenticated acceptance entry for the Overview deploy surface.
 *
 * Renders the SAME `DeploySurface` composition as the live App Overview ("/")
 * inside the real App-layer chrome but outside the auth guard, backed by the
 * in-memory fixture so it reviews on the web dev server alone (no API, login,
 * or seeded data). The simulated run machine walks empty → deploying → live;
 * the scenario switcher in the header covers all four exposure states (web,
 * agent-only, web-and-agents, native-red), and the demo control showcases the
 * legacy failed state.
 */
export function V0DeployPreviewPage() {
  const [scenario, setScenario] = useState<DeployConsoleScenario>("web");
  const demo = useDeployConsole(scenario);
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
          <>
            <div
              aria-label="Fixture scenario"
              className="border-border flex items-center gap-0.5 rounded-lg border p-0.5"
            >
              {SCENARIOS.map((option) => (
                <Button
                  key={option}
                  size="xs"
                  variant={option === scenario ? "secondary" : "ghost"}
                  onClick={() => {
                    setScenario(option);
                  }}
                >
                  {option}
                </Button>
              ))}
            </div>
            {deployment === null || demo.deploying ? null : (
              <Button variant="outline" size="sm" onClick={demo.failDeploy}>
                <CircleAlert className="size-3.5" />
                Simulate failed deploy
              </Button>
            )}
          </>
        }
      />
    </Layout>
  );
}
