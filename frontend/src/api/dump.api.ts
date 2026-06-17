import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";
import type { DataClass } from "@/domain/source";

export type DumpCreateRequest = {
  text: string;
  occurredAt?: string;
  dataClass?: DataClass;
  nonce?: string;
};

export type DumpCreateResponse = {
  rawEventId: string;
  idempotent: boolean;
};

export const dumpApi = {
  create: (orgId: string, body: DumpCreateRequest) =>
    apiClient.post<DumpCreateResponse>("/api/v1/ingest/dump", body, {
      headers: orgHeaders(orgId),
    }),
};
