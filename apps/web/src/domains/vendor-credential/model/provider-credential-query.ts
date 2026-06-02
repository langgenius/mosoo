import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toOrganizationId } from "@/routes/typed-id";

import { listVendorCredentials } from "../api/vendor-credential-client";
import type {
  CredentialPolicy,
  VendorCredential,
  VendorCredentialState,
} from "../api/vendor-credential-client";

interface VendorCredentialsQueryModel {
  credentials: VendorCredential[];
  credentialsQuery: UseQueryResult<VendorCredentialState>;
  loading: boolean;
  policy: CredentialPolicy | null;
}

export function useVendorCredentialsQuery(
  organizationId: string,
  includePolicy: boolean,
): VendorCredentialsQueryModel {
  const credentialsQuery = useQuery({
    queryFn: async () => listVendorCredentials(toOrganizationId(organizationId), includePolicy),
    queryKey: ["vendor-credentials", organizationId, includePolicy],
  });

  return {
    credentials: credentialsQuery.data?.credentials ?? [],
    credentialsQuery,
    loading: credentialsQuery.isLoading,
    policy: credentialsQuery.data?.policy ?? null,
  };
}
