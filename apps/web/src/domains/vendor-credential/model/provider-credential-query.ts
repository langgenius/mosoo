import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toProjectId } from "@/routes/typed-id";

import { listVendorCredentials } from "../api/vendor-credential-client";
import type { VendorCredential } from "../api/vendor-credential-client";

interface VendorCredentialsQueryModel {
  credentials: VendorCredential[];
  credentialsQuery: UseQueryResult<VendorCredential[]>;
  loading: boolean;
}

export function useVendorCredentialsQuery(projectId: string): VendorCredentialsQueryModel {
  const credentialsQuery = useQuery({
    queryFn: async () => listVendorCredentials(toProjectId(projectId)),
    queryKey: ["vendor-credentials", projectId],
  });

  return {
    credentials: credentialsQuery.data ?? [],
    credentialsQuery,
    loading: credentialsQuery.isLoading,
  };
}
