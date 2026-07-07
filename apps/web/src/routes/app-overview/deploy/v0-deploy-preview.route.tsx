import { CircleAlert } from "lucide-react";
import { useState } from "react";

import { Layout } from "@/app/app-shell";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

import { AppOverviewInstallGuide } from "../app-overview-install";
import { AGENT_INSTANCE_FIXTURE } from "./agent-instance-data";
import { AgentInstancePanel } from "./components/agent-instance-panel";
import { DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import type { DeployConsoleScenario } from "./deploy-console-data";
import { DeploySurface } from "./deploy-surface";
import { useDeployConsole } from "./use-deploy-console";

/**
 * Acceptance scenarios: the four deploy-surface exposure states plus "instance",
 * the reframed agent-instance Overview. "instance" has no deploy machine, so it
 * is not a {@link DeployConsoleScenario}.
 */
type PreviewScenario = DeployConsoleScenario | "instance";

/** All acceptance scenarios, in review order. */
const SCENARIOS: PreviewScenario[] = [
  "web",
  "agent-only",
  "web-and-agents",
  "native-red",
  "instance",
];

/**
 * Unauthenticated acceptance entry for the Overview deploy surface.
 *
 * Renders the SAME `DeploySurface` composition as the live App Overview ("/")
 * inside the real App-layer chrome but outside the auth guard, backed by the
 * in-memory fixture so it reviews on the web dev server alone (no API, login,
 * or seeded data). The simulated run machine walks empty → deploying → live;
 * the scenario switcher in the header covers the four deploy exposure states
 * (web, agent-only, web-and-agents, native-red), and the demo control showcases
 * the legacy failed state. The extra "instance" scenario swaps in the
 * `AgentInstancePanel` design prototype — a published, non-web agent reframed as
 * a remote stateful compute instance — while keeping the switcher visible so the
 * two framings can be compared side by side.
 */
export function V0DeployPreviewPage() {
  const [scenario, setScenario] = useState<PreviewScenario>("web");
  // `useDeployConsole` is a hook and must run every render; the "instance"
  // scenario has no deploy machine, so it borrows the "web" fixture (unused).
  const demo = useDeployConsole(scenario === "instance" ? "web" : scenario);
  const { deployment } = demo.state;

  const scenarioSwitcher = (
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
  );

  if (scenario === "instance") {
    return (
      <Layout>
        <AgentInstancePanel
          fixture={AGENT_INSTANCE_FIXTURE}
          headerBadges={<Badge variant="soil">Demo data</Badge>}
          headerActions={scenarioSwitcher}
        />
      </Layout>
    );
  }

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
            {scenarioSwitcher}
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
