import { CostPage } from "../cost/cost.route";

// App usage renders the cost report inside the Settings shell, so it behaves
// like the Profile and API tokens tabs instead of jumping to a standalone page.
export function UsageTab() {
  return <CostPage />;
}
