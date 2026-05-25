/**
 * API-клиент для `/admin/integrations/bots` — Conversational боты
 * (Telegram / Max / Email-inbox). Фаза 6 редизайна Z-Admin.
 *
 * Контракт backend: `AdminBotsController` под префиксом
 * `/api/v1/admin/integrations/bots`. Защита — `SuperAdminGuard`.
 *
 * На момент создания фронта бэкенд готовится параллельно — при отсутствии
 * эндпоинтов клиент получит 404, UI покажет `AdminEmpty`.
 */

import { apiClient } from './api-client';
import type {
  BotsOverviewApiDto,
  BotChannelSettingsApiDto,
  EmailInboxSettingsApiDto,
  BotKindApi,
} from '@/domain/admin-bot';

const BASE = '/api/v1/admin/integrations/bots';

export const adminBotsApi = {
  /** Сводка по всем трём каналам. */
  overview: (): Promise<BotsOverviewApiDto> =>
    apiClient.get<BotsOverviewApiDto>(BASE),

  /** Карточка одного бота. */
  fetchOne: (kind: BotKindApi): Promise<BotChannelSettingsApiDto> =>
    apiClient.get<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}`,
    ),

  /** Установить webhook (для telegram / max). */
  setWebhook: (
    kind: BotKindApi,
    args: { webhookUrl: string },
  ): Promise<BotChannelSettingsApiDto> =>
    apiClient.post<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}/webhook`,
      args,
    ),

  /** Удалить webhook. */
  deleteWebhook: (kind: BotKindApi): Promise<BotChannelSettingsApiDto> =>
    apiClient.del<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}/webhook`,
    ),

  /** Обновить токен бота (шифруется на сервере). */
  setToken: (
    kind: BotKindApi,
    args: { token: string },
  ): Promise<BotChannelSettingsApiDto> =>
    apiClient.put<BotChannelSettingsApiDto>(
      `${BASE}/${encodeURIComponent(kind)}/token`,
      args,
    ),

  /** Email-inbox: проверка соединения с IMAP/POP3. */
  testEmailInbox: (): Promise<{
    ok: boolean;
    message: string | null;
    settings: EmailInboxSettingsApiDto;
  }> => apiClient.post(`${BASE}/email_inbox/test`, {}),
};
