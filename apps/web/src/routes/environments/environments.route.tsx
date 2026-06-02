import { useParams } from "react-router-dom";

import { isTruthy } from "../../shared/lib/truthiness";
import { EnvironmentDetailPage } from "./environment-detail-page";
import { EnvironmentsListPage } from "./environments-list-page";
export function EnvironmentsPage() {
  const params = useParams();
  const { environmentId } = params;

  if (isTruthy(environmentId)) {
    return <EnvironmentDetailPage key={environmentId} environmentId={environmentId} />;
  }

  return <EnvironmentsListPage />;
}
