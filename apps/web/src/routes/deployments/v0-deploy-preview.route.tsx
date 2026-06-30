import { Layout } from "@/app/app-shell";

import { DeployConsoleView } from "./components/deploy-console-view";
import { DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import { useDeployConsole } from "./use-deploy-console";

/**
 * Unauthenticated acceptance entry for the v0 Deploy console.
 *
 * Renders the real {@link DeployConsoleView} inside the real App-layer chrome
 * but outside the auth guard, backed by the in-memory fixture so it reviews on
 * the web dev server alone (no API, login, or seeded data). The live console at
 * `/deployments` consumes `appOverview` via `useLiveDeployConsole`.
 */
export function V0DeployPreviewPage() {
  const { state, deploying, retryDeploy, deleteDeployment } = useDeployConsole();

  return (
    <Layout>
      <DeployConsoleView
        appName={DEPLOY_APP_IDENTITY.appName}
        state={state}
        deploying={deploying}
        canDeploy
        onRetry={retryDeploy}
        onDelete={deleteDeployment}
        demo
      />
    </Layout>
  );
}
