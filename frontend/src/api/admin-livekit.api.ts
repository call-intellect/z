import { apiClient } from "./api-client";
import type {
  LivekitOverviewApiDto,
  LivekitSfuHealthApiDto,
  LivekitEgressOverviewApiDto,
  LivekitTurnHealthApiDto,
} from "@/domain/admin-livekit";

const BASE = "/api/v1/admin/integrations/livekit";

export const adminLivekitApi = {
  overview: (): Promise<LivekitOverviewApiDto> =>
    apiClient.get<LivekitOverviewApiDto>(BASE),

  sfu: (): Promise<LivekitSfuHealthApiDto> =>
    apiClient.get<LivekitSfuHealthApiDto>(`${BASE}/sfu`),

  egress: (): Promise<LivekitEgressOverviewApiDto> =>
    apiClient.get<LivekitEgressOverviewApiDto>(`${BASE}/egress`),

  turn: (): Promise<LivekitTurnHealthApiDto> =>
    apiClient.get<LivekitTurnHealthApiDto>(`${BASE}/turn`),
};
