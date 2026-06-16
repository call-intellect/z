import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";

export interface MyCloneAccessResponseApi {
  personClones: string[];
  roleClones: string[];
  fetchedAt: string;
}

export const meCloneAccessApi = {
  get: (orgId: string) =>
    apiClient.get<MyCloneAccessResponseApi>("/api/v1/me/clone-access", {
      headers: orgHeaders(orgId),
    }),
};
