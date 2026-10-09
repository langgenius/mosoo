import type { ProjectId } from "@mosoo/id";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { listVendorCredentials } from "../api/vendor-credential-client";
import type { VendorCredential } from "../api/vendor-credential-client";

interface VendorCredentialsQueryModel {
  credentials: VendorCredential[];
  credentialsQuery: UseQueryResult<VendorCredential[]>;
  loading: boolean;
}

export const vendorCredentialKeys = {
  list: (projectId: string) => ["vendor-credentials", projectId] as const,
};

export function useVendorCredentialsQuery(projectId: ProjectId): VendorCredentialsQueryModel {
  const credentialsQuery = useQuery({
    queryFn: async () => listVendorCredentials(projectId),
    queryKey: vendorCredentialKeys.list(projectId),
  });

  return {
    credentials: credentialsQuery.data ?? [],
    credentialsQuery,
    loading: credentialsQuery.isLoading,
  };
}
