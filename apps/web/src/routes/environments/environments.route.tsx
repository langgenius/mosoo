import { useParams } from "react-router-dom";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentDetailPage } from "./environment-detail-page";
import { EnvironmentsListPage } from "./environments-list-page";
export function EnvironmentsPage() {
  const params = useParams();
  const { environmentId } = params;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {isTruthy(environmentId) ? (
        <EnvironmentDetailPage key={environmentId} environmentId={environmentId} />
      ) : (
        <EnvironmentsListPage />
      )}
    </div>
  );
}
