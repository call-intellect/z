import { apiClient } from "./api-client";
import type {
  BotsOverviewApiDto,
  BotChannelSettingsApiDto,
  EmailInboxSettingsApiDto,
  BotKindApi,
} from "@/domain/admin-bot";

const BASE = "/api/v1/admin/integrations/bots";

export const adminBotsApi = {
  overview: (): Promise<BotsOverviewApiDto> =>
    apiClient.get<BotsOverviewApiDto>(BASE),

  fetchOne: (kind: BotKindApi): Promise<BotChannelSettingsApiDto> =>
    apiClient.get<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}`,
    ),

  setWebhook: (
    kind: BotKindApi,
    args: { webhookUrl: string },
  ): Promise<BotChannelSettingsApiDto> =>
    apiClient.post<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}/webhook`,
      args,
    ),

  deleteWebhook: (kind: BotKindApi): Promise<BotChannelSettingsApiDto> =>
    apiClient.del<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}/webhook`,
    ),

  setToken: (
    kind: BotKindApi,
    args: { token: string },
  ): Promise<BotChannelSettingsApiDto> =>
    apiClient.put<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}/token`,
      args,
    ),

  testEmailInbox: (): Promise<{
    ok: boolean;
    message: string | null;
    settings: EmailInboxSettingsApiDto;
  }> => apiClient.post(`${BASE}/email_inbox/test`, {}),
};
