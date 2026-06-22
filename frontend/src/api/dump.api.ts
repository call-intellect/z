import { apiClient } from "./api-client";
import { orgHeaders } from "./admin-helpers";
import type { DataClass } from "@/domain/source";

export type DumpCreateRequest = {
  text: string;
  occurredAt?: string;
  dataClass?: DataClass;
  nonce?: string;
  asIdea?: boolean;
};

export type DumpCreateResponse = {
  rawEventId: string;
  idempotent: boolean;
};

export type DumpConfigResponse = {
  shortTextToIdeaThreshold: number;
};

export const dumpApi = {
  create: (orgId: string, body: DumpCreateRequest) =>
    apiClient.post<DumpCreateResponse>("/api/v1/ingest/dump", body, {
      headers: orgHeaders(orgId),
    }),

  config: (orgId: string) =>
    apiClient.get<DumpConfigResponse>("/api/v1/ingest/dump/config", {
      headers: orgHeaders(orgId),
    }),
};
