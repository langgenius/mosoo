import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toOrganizationId } from "@/routes/typed-id";

import { listVendorCredentials } from "../api/vendor-credential-client";
import type { VendorCredential } from "../api/vendor-credential-client";

interface VendorCredentialsQueryModel {
  credentials: VendorCredential[];
  credentialsQuery: UseQueryResult<VendorCredential[]>;
  loading: boolean;
}

export function useVendorCredentialsQuery(organizationId: string): VendorCredentialsQueryModel {
  const credentialsQuery = useQuery({
    queryFn: async () => listVendorCredentials(toOrganizationId(organizationId)),
    queryKey: ["vendor-credentials", organizationId],
  });

  return {
    credentials: credentialsQuery.data ?? [],
    credentialsQuery,
    loading: credentialsQuery.isLoading,
  };
}
