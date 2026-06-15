import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toAppId } from "@/routes/typed-id";

import { listVendorCredentials } from "../api/vendor-credential-client";
import type { VendorCredential } from "../api/vendor-credential-client";

interface VendorCredentialsQueryModel {
  credentials: VendorCredential[];
  credentialsQuery: UseQueryResult<VendorCredential[]>;
  loading: boolean;
}

export function useVendorCredentialsQuery(appId: string): VendorCredentialsQueryModel {
  const credentialsQuery = useQuery({
    queryFn: async () => listVendorCredentials(toAppId(appId)),
    queryKey: ["vendor-credentials", appId],
  });

  return {
    credentials: credentialsQuery.data ?? [],
    credentialsQuery,
    loading: credentialsQuery.isLoading,
  };
}
