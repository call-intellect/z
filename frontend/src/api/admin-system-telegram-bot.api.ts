/**
 * API-клиент для главной админки Z — глобальный Telegram-бот (β-9 Phase 4).
 *
 * Контракт: backend `AdminTelegramBotController`
 * (`backend/src/modules/admin/system/telegram-bot/admin-telegram-bot.controller.ts`).
 *
 * Все эндпоинты доступны только super-admin (cookie session + SuperAdminGuard).
 * Токен бота backend никогда не возвращает в plain — только метаданные:
 * `tokenIsSet` + `tokenLastChars` (последние 4 символа). Содержимое
 * переписки сотрудников admin'у тоже не доступно (продуктовый принцип №1).
 */

import { apiClient } from './api-client';
import type {
  TelegramBotBindingsPageApiDto,
  TelegramBotSettingsApiDto,
} from '@/domain/admin-telegram-bot';

export const adminSystemTelegramBotApi = {
  /** Получить текущие настройки глобального канала. */
  fetchSettings: (): Promise<TelegramBotSettingsApiDto> =>
    apiClient.get<TelegramBotSettingsApiDto>(
      '/api/v1/admin/system/telegram-bot',
    ),

  /** Установить/обновить токен бота. Token шифруется на сервере. */
  updateToken: (args: { token: string }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      '/api/v1/admin/system/telegram-bot/token',
      { token: args.token },
    ),

  /**
   * Перенастроить webhook: сгенерировать новый secret, вызвать
   * Telegram `setWebhook`, записать секрет в `Channel.config`.
   * Если `webhookUrl` не задан — используется computed URL
   * (`<PUBLIC_HOST_URL>/api/v1/webhooks/telegram-bot`).
   */
  resetWebhook: (args?: {
    webhookUrl?: string;
  }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      '/api/v1/admin/system/telegram-bot/webhook',
      args?.webhookUrl ? { webhookUrl: args.webhookUrl } : {},
    ),

  /** Обновить шаблоны сообщений бота. */
  updateTemplates: (args: {
    welcome?: string;
    notLinked?: string;
    employeeOffboarded?: string;
    orgFrozen?: string;
  }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      '/api/v1/admin/system/telegram-bot/templates',
      args,
    ),

  /** Включить/выключить бота глобально (kill-switch). */
  setStatus: (args: {
    status: 'active' | 'global_disabled';
  }): Promise<TelegramBotSettingsApiDto> =>
    apiClient.put<TelegramBotSettingsApiDto>(
      '/api/v1/admin/system/telegram-bot/status',
      { status: args.status },
    ),

  /** Список привязок сотрудников. БЕЗ содержимого переписки. */
  fetchBindings: (args?: {
    orgId?: string;
    status?:
      | 'linked'
      | 'pending'
      | 'no_membership'
      | 'bot_blocked'
      | 'inactive';
    page?: number;
    pageSize?: number;
  }): Promise<TelegramBotBindingsPageApiDto> => {
    const params = new URLSearchParams();
    if (args?.orgId) params.set('orgId', args.orgId);
    if (args?.status) params.set('status', args.status);
    if (args?.page) params.set('page', String(args.page));
    if (args?.pageSize) params.set('pageSize', String(args.pageSize));
    const qs = params.toString();
    return apiClient.get<TelegramBotBindingsPageApiDto>(
      `/api/v1/admin/system/telegram-bot/bindings${qs ? `?${qs}` : ''}`,
    );
  },
};
